import type { MCPTool, MCPPrompt } from './types.js';

interface JsonRpcResponse {
	jsonrpc: string;
	id: number;
	result?: unknown;
	error?: {
		code?: number;
		message?: string;
		data?: unknown;
	};
}

export class MCPHttpConnector {
	private baseUrl: string;
	private headers: Record<string, string>;

	constructor(baseUrl: string, headers: Record<string, string> = {}) {
		this.baseUrl = baseUrl.replace(/\/$/, '');
		this.headers = {
			'Content-Type': 'application/json',
			...headers,
		};
	}

	private async makeRequest(method: string, params?: unknown): Promise<unknown> {
		const body: {
			jsonrpc: string;
			id: number;
			method: string;
			params?: unknown;
		} = {
			jsonrpc: '2.0',
			id: Date.now(),
			method,
		};

		if (params) {
			body.params = params;
		}

		const response = await fetch(this.baseUrl, {
			method: 'POST',
			headers: this.headers,
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data = (await response.json()) as JsonRpcResponse;

		if (data.error) {
			throw new Error(`MCP Error: ${data.error.message || JSON.stringify(data.error)}`);
		}

		return data.result;
	}

	async listTools(): Promise<MCPTool[]> {
		const result = (await this.makeRequest('tools/list')) as { tools: MCPTool[] };
		return result.tools || [];
	}

	async listPrompts(): Promise<MCPPrompt[]> {
		try {
			const result = (await this.makeRequest('prompts/list')) as { prompts: MCPPrompt[] };
			return result.prompts || [];
		} catch (error) {
			return [];
		}
	}

	async getPrompt(
		name: string,
		args?: Record<string, string>
	): Promise<{ messages: Array<{ role: string; content: string }> }> {
		const result = (await this.makeRequest('prompts/get', {
			name,
			arguments: args,
		})) as { messages: Array<{ role: string; content: { type: string; text: string } | string }> };

		return {
			messages: result.messages.map((msg) => ({
				role: msg.role,
				content: typeof msg.content === 'string' ? msg.content : msg.content.text,
			})),
		};
	}

	async callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
		const result = (await this.makeRequest('tools/call', {
			name,
			arguments: input,
		})) as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };

		if (!result.content || result.content.length === 0) {
			return null;
		}

		const firstBlock = result.content[0];
		if (result.content.length === 1 && firstBlock && firstBlock.type === 'text') {
			const text = firstBlock.text || '';
			try {
				return JSON.parse(text);
			} catch {
				return text;
			}
		}

		return result.content.map((block) => {
			if (block.type === 'text') {
				return block.text;
			}
			return block;
		});
	}

	async disconnect(): Promise<void> {}
}
