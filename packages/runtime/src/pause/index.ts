import { PauseExecutionError, CallbackType } from './types.js';

export {
	PauseExecutionError,
	CallbackType,
	LLMOperation,
	EmbeddingOperation,
	ApprovalOperation,
	ToolOperation,
} from './types.js';

/**
 * Helper to create pause error
 */
export function pauseForCallback(
	type: CallbackType,
	operation: string,
	payload: Record<string, unknown>
): never {
	throw new PauseExecutionError(type, operation, payload);
}

/**
 * Check if error is a pause request
 */
export function isPauseError(error: unknown): error is PauseExecutionError {
	return error instanceof PauseExecutionError;
}
