export interface ServerLimits {
	maxTimeout: number;
	maxMemory: number;
	maxLLMCalls: number;
}

export interface ServerInfo {
	version: string;
	capabilities: {
		execution: boolean;
		search: boolean;
		streaming: boolean;
		llmCalls: boolean;
	};
	limits: ServerLimits;
}

/**
 * Generates server information object
 */
export function getServerInfo(limits: ServerLimits): ServerInfo {
	return {
		version: '1.0.0',
		capabilities: { execution: true, search: true, streaming: false, llmCalls: true },
		limits: {
			maxTimeout: limits.maxTimeout,
			maxMemory: limits.maxMemory,
			maxLLMCalls: limits.maxLLMCalls,
		},
	};
}
