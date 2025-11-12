/**
 * Callback types that can pause execution
 */
export enum CallbackType {
	LLM = 'llm',
	APPROVAL = 'approval',
	EMBEDDING = 'embedding',
	TOOL = 'tool',
}

/**
 * LLM callback operations
 */
export enum LLMOperation {
	CALL = 'call',
	EXTRACT = 'extract',
	CLASSIFY = 'classify',
}

/**
 * Embedding callback operations
 */
export enum EmbeddingOperation {
	EMBED = 'embed',
	SEARCH = 'search',
}

/**
 * Approval callback operations
 */
export enum ApprovalOperation {
	REQUEST = 'request',
}

/**
 * Tool callback operations
 */
export enum ToolOperation {
	CALL = 'call',
}

/**
 * Thrown when execution needs to pause for client callback
 */
export class PauseExecutionError extends Error {
	public readonly type: CallbackType;
	public readonly operation: string;
	public readonly payload: Record<string, unknown>;

	constructor(type: CallbackType, operation: string, payload: Record<string, unknown>) {
		super(`Execution paused: waiting for ${type}.${operation}`);
		this.name = 'PauseExecutionError';
		this.type = type;
		this.operation = operation;
		this.payload = payload;
	}
}
