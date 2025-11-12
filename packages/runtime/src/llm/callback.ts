/**
 */
import type { ClientLLMCallback } from './types';

/**
 * Client callback handler for LLM operations
 * When set, LLM calls will be routed to client instead of server LLM
 */
let clientLLMCallback: ClientLLMCallback | undefined;

/**
 * Sets a client callback handler for LLM operations
 * @param callback - Client callback handler
 */
export function setClientLLMCallback(callback: ClientLLMCallback | undefined): void {
	clientLLMCallback = callback;
}

/**
 * Gets the current client callback handler
 */
export function getClientLLMCallback(): ClientLLMCallback | undefined {
	return clientLLMCallback;
}
