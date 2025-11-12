export interface DatabaseMockMCPConfig {
	oauthIntrospectUrl: string;
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

interface Record {
	id: string;
	data: any;
}

export class DatabaseMockMCP {
	private oauthIntrospectUrl: string;
	private tables: Map<string, Map<string, Record>> = new Map();
	private initialized = false;
	private recordIdCounter = 1;

	constructor(config: DatabaseMockMCPConfig) {
		this.oauthIntrospectUrl = config.oauthIntrospectUrl;
		this.initializeMockData();
	}

	private initializeMockData(): void {
		const usersTable = new Map<string, Record>();
		usersTable.set('1', { id: '1', data: { name: 'User 1', email: 'user1@example.com' } });
		usersTable.set('2', { id: '2', data: { name: 'User 2', email: 'user2@example.com' } });
		this.tables.set('users', usersTable);
	}

	async handleRequest(request: MCPRequest, authToken?: string): Promise<MCPResponse> {
		const scopes = await this.validateAuth(authToken);
		if (!scopes) {
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
					return this.handleCallTool(request, scopes);
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

	private async validateAuth(token?: string): Promise<string[] | null> {
		if (!token) {
			return null;
		}

		try {
			const response = await fetch(this.oauthIntrospectUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: `token=${token}`,
			});

			const data = (await response.json()) as { active: boolean; scope: string };
			if (!data.active) {
				return null;
			}

			return data.scope ? data.scope.split(' ') : [];
		} catch (error) {
			return null;
		}
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
					name: 'database-mock-mcp',
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
						name: 'query',
						description: 'Query records from a table (requires db:read scope)',
						inputSchema: {
							type: 'object',
							properties: {
								table: { type: 'string' },
								filter: { type: 'object' },
							},
							required: ['table'],
						},
					},
					{
						name: 'insert',
						description: 'Insert a record into a table (requires db:write scope)',
						inputSchema: {
							type: 'object',
							properties: {
								table: { type: 'string' },
								data: { type: 'object' },
							},
							required: ['table', 'data'],
						},
					},
					{
						name: 'update',
						description: 'Update a record (requires db:write scope)',
						inputSchema: {
							type: 'object',
							properties: {
								table: { type: 'string' },
								id: { type: 'string' },
								data: { type: 'object' },
							},
							required: ['table', 'id', 'data'],
						},
					},
					{
						name: 'delete',
						description: 'Delete a record (requires db:write scope)',
						inputSchema: {
							type: 'object',
							properties: {
								table: { type: 'string' },
								id: { type: 'string' },
							},
							required: ['table', 'id'],
						},
					},
					{
						name: 'createTable',
						description: 'Create a new table (requires db:admin scope)',
						inputSchema: {
							type: 'object',
							properties: {
								name: { type: 'string' },
							},
							required: ['name'],
						},
					},
				],
			},
		};
	}

	private handleCallTool(request: MCPRequest, scopes: string[]): MCPResponse {
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
			case 'query':
				return this.toolQuery(request.id, args, scopes);
			case 'insert':
				return this.toolInsert(request.id, args, scopes);
			case 'update':
				return this.toolUpdate(request.id, args, scopes);
			case 'delete':
				return this.toolDelete(request.id, args, scopes);
			case 'createTable':
				return this.toolCreateTable(request.id, args, scopes);
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

	private toolQuery(id: number | string, args: any, scopes: string[]): MCPResponse {
		if (!scopes.includes('db:read')) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32001,
					message: 'Insufficient scope: db:read required',
				},
			};
		}

		const table = this.tables.get(args.table);
		if (!table) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32603,
					message: `Table not found: ${args.table}`,
				},
			};
		}

		const records = Array.from(table.values());

		return {
			jsonrpc: '2.0',
			id,
			result: {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ records }),
					},
				],
			},
		};
	}

	private toolInsert(id: number | string, args: any, scopes: string[]): MCPResponse {
		if (!scopes.includes('db:write')) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32001,
					message: 'Insufficient scope: db:write required',
				},
			};
		}

		let table = this.tables.get(args.table);
		if (!table) {
			table = new Map();
			this.tables.set(args.table, table);
		}

		const recordId = String(this.recordIdCounter++);
		const record: Record = {
			id: recordId,
			data: args.data,
		};

		table.set(recordId, record);

		return {
			jsonrpc: '2.0',
			id,
			result: {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ record }),
					},
				],
			},
		};
	}

	private toolUpdate(id: number | string, args: any, scopes: string[]): MCPResponse {
		if (!scopes.includes('db:write')) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32001,
					message: 'Insufficient scope: db:write required',
				},
			};
		}

		const table = this.tables.get(args.table);
		if (!table) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32603,
					message: `Table not found: ${args.table}`,
				},
			};
		}

		const record = table.get(args.id);
		if (!record) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32603,
					message: `Record not found: ${args.id}`,
				},
			};
		}

		record.data = { ...record.data, ...args.data };

		return {
			jsonrpc: '2.0',
			id,
			result: {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ record }),
					},
				],
			},
		};
	}

	private toolDelete(id: number | string, args: any, scopes: string[]): MCPResponse {
		if (!scopes.includes('db:write')) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32001,
					message: 'Insufficient scope: db:write required',
				},
			};
		}

		const table = this.tables.get(args.table);
		if (!table) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32603,
					message: `Table not found: ${args.table}`,
				},
			};
		}

		const deleted = table.delete(args.id);
		if (!deleted) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32603,
					message: `Record not found: ${args.id}`,
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
						text: 'Record deleted',
					},
				],
			},
		};
	}

	private toolCreateTable(id: number | string, args: any, scopes: string[]): MCPResponse {
		if (!scopes.includes('db:admin')) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32001,
					message: 'Insufficient scope: db:admin required',
				},
			};
		}

		if (this.tables.has(args.name)) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32603,
					message: `Table already exists: ${args.name}`,
				},
			};
		}

		this.tables.set(args.name, new Map());

		return {
			jsonrpc: '2.0',
			id,
			result: {
				content: [
					{
						type: 'text',
						text: `Table created: ${args.name}`,
					},
				],
			},
		};
	}
}
