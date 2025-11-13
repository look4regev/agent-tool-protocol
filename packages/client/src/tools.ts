import type { AgentToolProtocolClient } from './client.js';
import {
	type Tool,
	createSearchApiTool,
	createFetchAllApisTool,
	createExecuteCodeTool,
	createExploreApiTool,
} from './tools/index.js';

/**
 * Creates MCP-compliant tool definitions with execution handlers
 * These tools work with any LLM/agent framework
 */
export function createToolsFromATPClient(client: AgentToolProtocolClient): Tool[] {
	return [
		createSearchApiTool(client),
		createFetchAllApisTool(client),
		createExecuteCodeTool(client),
		createExploreApiTool(client),
	];
}
