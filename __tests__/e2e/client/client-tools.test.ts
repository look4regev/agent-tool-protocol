import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { createServer } from '@agent-tool-protocol/server';
import {
	ToolOperationType,
	ToolSensitivityLevel,
	type ClientTool,
	ExecutionStatus,
} from '@mondaydotcomorg/atp-protocol';
import type { Server } from 'http';

/**
 * End-to-end tests for client-provided tools
 */

describe('Client-Provided Tools', () => {
	let server: any;
	let PORT: number;
	const createdClients: AgentToolProtocolClient[] = [];

	const getTestPort = () => 3456 + Math.floor(Math.random() * 100);

	const waitForServer = async (port: number, maxAttempts = 10) => {
		for (let i = 0; i < maxAttempts; i++) {
			try {
				await fetch(`http://localhost:${port}/api/info`);
				return;
			} catch (e) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
		throw new Error(`Server did not start on port ${port}`);
	};

	// Test tools
	const testTools: ClientTool[] = [
		{
			name: 'add',
			namespace: 'math',
			description: 'Add two numbers',
			inputSchema: {
				type: 'object',
				properties: {
					a: { type: 'number' },
					b: { type: 'number' },
				},
				required: ['a', 'b'],
			},
			metadata: {
				operationType: ToolOperationType.READ,
				sensitivityLevel: ToolSensitivityLevel.PUBLIC,
			},
			handler: async (input: any) => {
				return { result: input.a + input.b };
			},
		},
		{
			name: 'concat',
			namespace: 'string',
			description: 'Concatenate two strings',
			inputSchema: {
				type: 'object',
				properties: {
					str1: { type: 'string' },
					str2: { type: 'string' },
				},
				required: ['str1', 'str2'],
			},
			metadata: {
				operationType: ToolOperationType.READ,
			},
			handler: async (input: any) => {
				return { result: input.str1 + input.str2 };
			},
		},
		{
			name: 'getTimestamp',
			description: 'Get current timestamp',
			inputSchema: {
				type: 'object',
				properties: {},
			},
			handler: async () => {
				return { timestamp: Date.now() };
			},
		},
	];

	beforeAll(async () => {
		// Set required environment variable for JWT
		process.env.ATP_JWT_SECRET = 'test-secret-key-for-client-tools-e2e-testing';
		PORT = getTestPort();
	});

	afterEach(async () => {
		// Clean up server after each test
		if (server) {
			try {
				await server.stop();
			} catch (e) {
				// Ignore
			}
			server = null;
		}

		// Clean up clients
		for (const client of createdClients) {
			try {
				(client as any).serviceProviders = null;
			} catch (e) {
				// Ignore
			}
		}
		createdClients.length = 0;
	});

	afterAll(async () => {
		// Final cleanup
		createdClients.length = 0;
	});

	it('should register client tools during initialization', async () => {
		// Create server for this test
		server = createServer({
			execution: {
				timeout: 10000,
				memory: 64 * 1024 * 1024,
				llmCalls: 5,
			},
			logger: 'error',
		});
		await server.listen(PORT);
		await waitForServer(PORT);

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${PORT}`,
			serviceProviders: {
				tools: testTools,
			},
		});
		createdClients.push(client);

		const initResult = await client.init({
			name: 'test-client',
			version: '1.0.0',
		});

		expect(initResult.clientId).toBeDefined();
		expect(initResult.token).toBeDefined();
	});

	it('should execute client tool successfully', async () => {
		server = createServer({
			execution: {
				timeout: 10000,
				memory: 64 * 1024 * 1024,
				llmCalls: 5,
			},
			logger: 'error',
		});
		await server.listen(PORT);
		await waitForServer(PORT);

		const tools = [
			{
				name: 'add',
				namespace: 'math',
				description: 'Add two numbers',
				inputSchema: {
					type: 'object',
					properties: {
						a: { type: 'number' },
						b: { type: 'number' },
					},
					required: ['a', 'b'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async (input) => {
					return { result: input.a + input.b };
				},
			},
		];

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${PORT}`,
			serviceProviders: { tools },
		});
		createdClients.push(client);

		await client.init({ name: 'exec-test-client' });

		const code = `const result = await api.math.add({ a: 5, b: 3 }); return result;`;
		const execResult = await client.execute(code);

		expect(execResult.status).toBe(ExecutionStatus.COMPLETED);
		expect(execResult.result).toEqual({ result: 8 });
	});

	it('should handle multiple client tool calls', async () => {
		server = createServer({
			execution: {
				timeout: 10000,
				memory: 64 * 1024 * 1024,
				llmCalls: 5,
			},
			logger: 'error',
		});
		await server.listen(PORT);
		await waitForServer(PORT);

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${PORT}`,
			serviceProviders: { tools: testTools },
		});
		createdClients.push(client);

		await client.init({ name: 'multi-tool-client' });

		const code = `
			const sum = await api.math.add({ a: 10, b: 20 });
			const concat = await api.string.concat({ str1: 'Hello', str2: ' World' });
			const timestamp = await api.client.getTimestamp();
			
			return {
				sum: sum.result,
				concat: concat.result,
				hasTimestamp: typeof timestamp.timestamp === 'number'
			};
		`;

		const execResult = await client.execute(code);

		expect(execResult.status).toBe(ExecutionStatus.COMPLETED);
		expect((execResult.result as any).sum).toBe(30);
		expect((execResult.result as any).concat).toBe('Hello World');
		expect((execResult.result as any).hasTimestamp).toBe(true);
	});

	it('should handle tool errors gracefully', async () => {
		server = createServer({
			execution: {
				timeout: 10000,
				memory: 64 * 1024 * 1024,
				llmCalls: 5,
			},
			logger: 'error',
		});
		await server.listen(PORT);
		await waitForServer(PORT);

		const errorTool = [
			{
				name: 'throwError',
				description: 'Tool that throws',
				inputSchema: {
					type: 'object',
					properties: {},
				},
				handler: async () => {
					throw new Error('Test error from handler');
				},
			},
		];

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${PORT}`,
			serviceProviders: { tools: errorTool },
		});
		createdClients.push(client);

		await client.init({ name: 'error-test-client' });

		const code = `
			try {
				await api.client.throwError();
				return { error: false };
			} catch (error) {
				return { error: true, message: error.message };
			}
		`;

		const execResult = await client.execute(code);

		expect(execResult.status).toBe(ExecutionStatus.COMPLETED);
		expect((execResult.result as any).error).toBe(true);
		expect((execResult.result as any).message).toContain('Test error');
	});
});
