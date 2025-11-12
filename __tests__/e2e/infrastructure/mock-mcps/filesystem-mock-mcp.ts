export interface FilesystemMockMCPConfig {
	authToken: string;
	files?: Map<string, string>;
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

export class FilesystemMockMCP {
	private authToken: string;
	private files: Map<string, string> = new Map();
	private initialized = false;

	constructor(config: FilesystemMockMCPConfig) {
		this.authToken = config.authToken;
		if (config.files) {
			this.files = new Map(config.files);
		} else {
			this.initializeMockFiles();
		}
	}

	private initializeMockFiles(): void {
		this.files.set('/test/file1.txt', 'Content of file 1');
		this.files.set('/test/file2.txt', 'Content of file 2');
		this.files.set('/data/config.json', '{"key":"value","enabled":true}');
	}

	async handleRequest(request: MCPRequest, authToken?: string): Promise<MCPResponse> {
		if (!this.validateAuth(authToken)) {
			return {
				jsonrpc: '2.0',
				id: request.id,
				error: {
					code: -32001,
					message: 'Unauthorized: Invalid or missing auth token',
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

	private validateAuth(token?: string): boolean {
		return token === this.authToken;
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
					name: 'filesystem-mock-mcp',
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
						name: 'readFile',
						description: 'Read a file from the filesystem',
						inputSchema: {
							type: 'object',
							properties: {
								path: {
									type: 'string',
									description: 'Path to the file',
								},
							},
							required: ['path'],
						},
					},
					{
						name: 'writeFile',
						description: 'Write content to a file',
						inputSchema: {
							type: 'object',
							properties: {
								path: {
									type: 'string',
									description: 'Path to the file',
								},
								content: {
									type: 'string',
									description: 'Content to write',
								},
							},
							required: ['path', 'content'],
						},
					},
					{
						name: 'listDirectory',
						description: 'List files in a directory',
						inputSchema: {
							type: 'object',
							properties: {
								path: {
									type: 'string',
									description: 'Directory path',
								},
							},
							required: ['path'],
						},
					},
					{
						name: 'deleteFile',
						description: 'Delete a file',
						inputSchema: {
							type: 'object',
							properties: {
								path: {
									type: 'string',
									description: 'Path to the file',
								},
							},
							required: ['path'],
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
			case 'readFile':
				return this.toolReadFile(request.id, args);
			case 'writeFile':
				return this.toolWriteFile(request.id, args);
			case 'listDirectory':
				return this.toolListDirectory(request.id, args);
			case 'deleteFile':
				return this.toolDeleteFile(request.id, args);
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

	private toolReadFile(id: number | string, args: any): MCPResponse {
		const path = args.path;
		const content = this.files.get(path);

		if (!content) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32603,
					message: `File not found: ${path}`,
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
						text: content,
					},
				],
			},
		};
	}

	private toolWriteFile(id: number | string, args: any): MCPResponse {
		const { path, content } = args;
		this.files.set(path, content);

		return {
			jsonrpc: '2.0',
			id,
			result: {
				content: [
					{
						type: 'text',
						text: `File written: ${path}`,
					},
				],
			},
		};
	}

	private toolListDirectory(id: number | string, args: any): MCPResponse {
		const dirPath = args.path;
		const files = Array.from(this.files.keys()).filter((path) => path.startsWith(dirPath));

		return {
			jsonrpc: '2.0',
			id,
			result: {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ files }),
					},
				],
			},
		};
	}

	private toolDeleteFile(id: number | string, args: any): MCPResponse {
		const path = args.path;
		const deleted = this.files.delete(path);

		if (!deleted) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32603,
					message: `File not found: ${path}`,
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
						text: `File deleted: ${path}`,
					},
				],
			},
		};
	}
}
