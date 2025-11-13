export const ToolNames = {
	SEARCH_API: 'search_api',
	FETCH_ALL_APIS: 'fetch_all_apis',
	EXECUTE_CODE: 'execute_code',
	EXPLORE_API: 'explore_api',
} as const;

export type ToolName = (typeof ToolNames)[keyof typeof ToolNames];

/**
 * Tool definition following MCP (Model Context Protocol) convention
 * with added execution function
 */
export interface Tool<TInput = any> {
	name: string;
	description?: string;
	inputSchema: {
		type: string;
		properties?: Record<string, unknown>;
		required?: string[];
	};
	zodSchema?: any;
	func: (input: TInput) => Promise<string>;
}
