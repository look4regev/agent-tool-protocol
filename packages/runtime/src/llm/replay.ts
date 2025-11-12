import { AsyncLocalStorage } from 'async_hooks';

/**
 * Execution-scoped state
 */
interface ExecutionState {
	shouldPauseForClient: boolean;
	replayResults: Map<number, unknown> | undefined;
	callSequenceNumber: number;
}

/**
 * Map of executionId -> ExecutionState
 * Each execution has its own isolated state
 */
const executionStates = new Map<string, ExecutionState>();

/**
 * AsyncLocalStorage for execution ID - provides proper async context isolation
 * This ensures each async execution chain has its own isolated execution ID
 */
const executionContext = new AsyncLocalStorage<string>();

/**
 * Current execution ID - set by runtime API wrappers
 * This is a thread-local variable that's set before each runtime API call
 * and cleared after, providing isolation even when AsyncLocalStorage fails
 */
let currentExecutionId: string | null = null;

/**
 * Sets the current execution ID for this call
 * Called by executor before each runtime API invocation
 */
export function setCurrentExecutionId(executionId: string): void {
	currentExecutionId = executionId;
}

/**
 * Clears the current execution ID after a call
 * Called by executor after each runtime API invocation
 */
export function clearCurrentExecutionId(): void {
	currentExecutionId = null;
}

/**
 * Gets the current execution state, creating it if needed
 */
function getCurrentState(): ExecutionState {
	let executionId = currentExecutionId;

	if (!executionId) {
		executionId = executionContext.getStore() || null;
	}

	if (!executionId) {
		throw new Error(
			'No execution context set. Executor must call setCurrentExecutionId() before runtime API calls.'
		);
	}

	let state = executionStates.get(executionId);
	if (!state) {
		state = {
			shouldPauseForClient: false,
			replayResults: undefined,
			callSequenceNumber: 0,
		};
		executionStates.set(executionId, state);
	}
	return state;
}

/**
 * Runs a function within an execution context
 * @param executionId - Unique ID for this execution
 * @param fn - Function to run within the context
 */
export function runInExecutionContext<T>(executionId: string, fn: () => T): T {
	return executionContext.run(executionId, fn);
}

/**
 * Configures whether to pause execution for client services
 * @param pause - If true, throws PauseExecutionError instead of calling callback
 */
export function setPauseForClient(pause: boolean): void {
	getCurrentState().shouldPauseForClient = pause;
}

/**
 * Checks if should pause for client
 */
export function shouldPauseForClient(): boolean {
	return getCurrentState().shouldPauseForClient;
}

/**
 * Sets up replay mode for resumption
 * @param results - Map of sequence number to result for replaying callbacks
 */
export function setReplayMode(results: Map<number, unknown> | undefined): void {
	const state = getCurrentState();
	state.replayResults = results;
	state.callSequenceNumber = 0;
}

/**
 * Gets current call sequence number
 */
export function getCallSequenceNumber(): number {
	return getCurrentState().callSequenceNumber;
}

/**
 * Increments and returns the next sequence number
 */
export function nextSequenceNumber(): number {
	const state = getCurrentState();
	return state.callSequenceNumber++;
}

/**
 * Check if we have a cached result for the current sequence
 */
export function getCachedResult(sequenceNumber: number): unknown | undefined {
	const state = getCurrentState();
	if (state.replayResults && state.replayResults.has(sequenceNumber)) {
		const result = state.replayResults.get(sequenceNumber);
		return result;
	}
	return undefined;
}

/**
 * Check if we're in replay mode
 */
export function isReplayMode(): boolean {
	return getCurrentState().replayResults !== undefined;
}
