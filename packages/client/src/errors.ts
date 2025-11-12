/**
 * Base error class for exceptions thrown by client callbacks that should
 * be propagated through the execution flow rather than being caught and
 * converted to error results.
 *
 * Use this when client-side service providers need to interrupt normal
 * execution flow (e.g., for human-in-the-loop workflows, custom control flow).
 *
 * @example
 * ```typescript
 * class CustomInterruptException extends ClientCallbackError {
 *   constructor(message: string, public data: any) {
 *     super(message);
 *     this.name = 'CustomInterruptException';
 *   }
 * }
 * ```
 */
export class ClientCallbackError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ClientCallbackError';
	}
}
