/**
 * LangChain Integration for Agent Tool Protocol
 *
 * Converts ATP client tools into LangChain DynamicTool instances
 */

import {
	AgentToolProtocolClient,
	createToolsFromATPClient,
	type Tool,
	type ClientHooks,
} from '@agent-tool-protocol/client';
import { DynamicTool } from '@langchain/core/tools';

/**
 * Creates ATP client and returns LangChain-compatible DynamicTool instances
 * The client is automatically connected and ready to use.
 *
 * @param serverUrl - ATP server URL (e.g. 'http://localhost:3333')
 * @param headers - Optional headers for authentication (e.g. { Authorization: 'Bearer token' })
 * @param hooks - Optional hooks for intercepting and modifying client behavior
 * @returns Promise of { client, tools } where tools is an array of LangChain DynamicTools
 *
 * @example
 * ```typescript
 * const { client, tools } = await createATPTools('http://localhost:3333', {
 *   Authorization: 'Bearer api-key'
 * });
 *
 * // Use tools with any LangChain agent
 * const agent = await createReactAgent({ llm, tools, prompt });
 * const executor = new AgentExecutor({ agent, tools });
 * ```
 */
export async function createATPTools(
	serverUrl: string,
	headers?: Record<string, string>,
	hooks?: ClientHooks
) {
	const client = new AgentToolProtocolClient({ baseUrl: serverUrl, headers, hooks });
	await client.connect();

	const atpTools = createToolsFromATPClient(client);

	const tools = atpTools.map(
		(tool: Tool) =>
			new DynamicTool({
				name: tool.name,
				description: tool.description || '',
				func: tool.func,
			})
	);

	return { client, tools };
}

/**
 * Converts generic ATP tools into LangChain DynamicTool instances
 *
 * @param tools - Array of ATP tools (with inputSchema and func)
 * @returns Array of LangChain DynamicTools
 */
export function convertToLangChainTools(tools: Tool[]): DynamicTool[] {
	return tools.map(
		(tool: Tool) =>
			new DynamicTool({
				name: tool.name,
				description: tool.description || '',
				func: tool.func,
			})
	);
}
