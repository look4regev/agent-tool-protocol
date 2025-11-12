export interface SlackMockMCPConfig {
	apiKey: string;
}

interface MCPRequest {
	jsonrpc: string;
	id: number | string;
	method: string;
	params?: any;
}

interface MCPResponse {
	jsonrpc: string;
	id: number | string;
	result?: any;
	error?: {
		code: number;
		message: string;
	};
}

interface Channel {
	id: string;
	name: string;
	is_private: boolean;
}

interface Message {
	id: string;
	channel: string;
	text: string;
	timestamp: number;
}

export class SlackMockMCP {
	private apiKey: string;
	private channels: Map<string, Channel> = new Map();
	private messages: Message[] = [];
	private initialized = false;
	private messageIdCounter = 1;

	constructor(config: SlackMockMCPConfig) {
		this.apiKey = config.apiKey;
		this.initializeMockData();
	}

	private initializeMockData(): void {
		this.channels.set('C001', {
			id: 'C001',
			name: 'general',
			is_private: false,
		});
		this.channels.set('C002', {
			id: 'C002',
			name: 'random',
			is_private: false,
		});
	}

	async handleRequest(request: MCPRequest, apiKey?: string): Promise<MCPResponse> {
		if (!this.validateAuth(apiKey)) {
			return {
				jsonrpc: '2.0',
				id: request.id,
				error: {
					code: -32001,
					message: 'Unauthorized: Invalid or missing API key',
				},
			};
		}

		try {
			switch (request.method) {
				case 'initialize':
					return this.handleInitialize(request);
				case 'tools/list':
					return this.handleListTools(request);
				case 'tools/call':
					return this.handleCallTool(request);
				default:
					return {
						jsonrpc: '2.0',
						id: request.id,
						error: {
							code: -32601,
							message: 'Method not found',
						},
					};
			}
		} catch (error: any) {
			return {
				jsonrpc: '2.0',
				id: request.id,
				error: {
					code: -32603,
					message: error.message,
				},
			};
		}
	}

	private validateAuth(apiKey?: string): boolean {
		return apiKey === this.apiKey;
	}

	private handleInitialize(request: MCPRequest): MCPResponse {
		this.initialized = true;
		return {
			jsonrpc: '2.0',
			id: request.id,
			result: {
				protocolVersion: '0.1.0',
				capabilities: {
					tools: {},
				},
				serverInfo: {
					name: 'slack-mock-mcp',
					version: '1.0.0',
				},
			},
		};
	}

	private handleListTools(request: MCPRequest): MCPResponse {
		if (!this.initialized) {
			return {
				jsonrpc: '2.0',
				id: request.id,
				error: {
					code: -32002,
					message: 'Not initialized',
				},
			};
		}

		return {
			jsonrpc: '2.0',
			id: request.id,
			result: {
				tools: [
					{
						name: 'postMessage',
						description: 'Post a message to a Slack channel',
						inputSchema: {
							type: 'object',
							properties: {
								channel: {
									type: 'string',
									description: 'Channel ID',
								},
								text: {
									type: 'string',
									description: 'Message text',
								},
							},
							required: ['channel', 'text'],
						},
					},
					{
						name: 'listChannels',
						description: 'List all channels',
						inputSchema: {
							type: 'object',
							properties: {},
						},
					},
					{
						name: 'getChannel',
						description: 'Get channel information',
						inputSchema: {
							type: 'object',
							properties: {
								channel: {
									type: 'string',
									description: 'Channel ID',
								},
							},
							required: ['channel'],
						},
					},
				],
			},
		};
	}

	private handleCallTool(request: MCPRequest): MCPResponse {
		if (!this.initialized) {
			return {
				jsonrpc: '2.0',
				id: request.id,
				error: {
					code: -32002,
					message: 'Not initialized',
				},
			};
		}

		const { name, arguments: args } = request.params;

		switch (name) {
			case 'postMessage':
				return this.toolPostMessage(request.id, args);
			case 'listChannels':
				return this.toolListChannels(request.id);
			case 'getChannel':
				return this.toolGetChannel(request.id, args);
			default:
				return {
					jsonrpc: '2.0',
					id: request.id,
					error: {
						code: -32601,
						message: `Tool not found: ${name}`,
					},
				};
		}
	}

	private toolPostMessage(id: number | string, args: any): MCPResponse {
		const channel = this.channels.get(args.channel);
		if (!channel) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32603,
					message: `Channel not found: ${args.channel}`,
				},
			};
		}

		const message: Message = {
			id: String(this.messageIdCounter++),
			channel: args.channel,
			text: args.text,
			timestamp: Date.now(),
		};

		this.messages.push(message);

		return {
			jsonrpc: '2.0',
			id,
			result: {
				content: [
					{
						type: 'text',
						text: JSON.stringify({
							ok: true,
							message,
						}),
					},
				],
			},
		};
	}

	private toolListChannels(id: number | string): MCPResponse {
		const channels = Array.from(this.channels.values());

		return {
			jsonrpc: '2.0',
			id,
			result: {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ channels }),
					},
				],
			},
		};
	}

	private toolGetChannel(id: number | string, args: any): MCPResponse {
		const channel = this.channels.get(args.channel);
		if (!channel) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32603,
					message: `Channel not found: ${args.channel}`,
				},
			};
		}

		return {
			jsonrpc: '2.0',
			id,
			result: {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ channel }),
					},
				],
			},
		};
	}
}
