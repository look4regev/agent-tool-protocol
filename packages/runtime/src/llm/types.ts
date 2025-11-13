export interface LLMCallOptions {
	prompt: string;
	context?: Record<string, unknown>;
	model?: string;
	maxTokens?: number;
	temperature?: number;
	systemPrompt?: string;
}

export interface LLMExtractOptions {
	prompt: string;
	context?: Record<string, unknown>;
	schema: unknown;
}

export interface LLMClassifyOptions {
	text: string;
	categories: string[];
	context?: Record<string, unknown>;
}

/**
 * Client callback handler for LLM operations
 * Set when client provides their own LLM implementation
 */
export type ClientLLMCallback = (
	operation: string,
	payload: Record<string, unknown>
) => Promise<unknown>;
