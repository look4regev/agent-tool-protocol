import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@agent-tool-protocol/client';
import {
	ExecutionStatus,
	ToolOperationType,
	ToolSensitivityLevel,
} from '@agent-tool-protocol/protocol';
import type { ClientTool } from '@agent-tool-protocol/protocol';
import {
	createTestATPServer,
	createCleanupTracker,
	cleanupAll,
	type TestServer,
	type CleanupTracker,
} from '../../infrastructure/test-helpers';

describe('Phase 1: Client Tools with Pause/Resume', () => {
	let atpServer: TestServer;
	let cleanup: CleanupTracker;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-client-tools-pause-resume';
		cleanup = createCleanupTracker();

		atpServer = await createTestATPServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
			},
		});

		cleanup.servers.push(atpServer);
	});

	afterAll(async () => {
		await cleanupAll(cleanup);
	});

	it('should pause execution when client tool is called and resume with result', async () => {
		const clientTools: ClientTool[] = [
			{
				name: 'readLocal',
				description: 'Read local data',
				inputSchema: {
					type: 'object',
					properties: {
						key: { type: 'string' },
					},
					required: ['key'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
					sensitivityLevel: ToolSensitivityLevel.PUBLIC,
				},
				handler: async (input: any) => {
					return { data: `local-data-for-${input.key}` };
				},
			},
		];

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
			serviceProviders: {
				tools: clientTools,
			},
		});

		cleanup.clients.push(client);

		await client.init({ name: 'client-tools-test' });

		const code = `
			const result = await api.client.readLocal({ key: 'test-key' });
			return result;
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		expect((result.result as any).data).toBe('local-data-for-test-key');
	});

	it('should handle multiple sequential client tool calls', async () => {
		const clientTools: ClientTool[] = [
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
				handler: async (input: any) => {
					return { result: input.a + input.b };
				},
			},
			{
				name: 'multiply',
				namespace: 'math',
				description: 'Multiply two numbers',
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
				handler: async (input: any) => {
					return { result: input.a * input.b };
				},
			},
		];

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
			serviceProviders: {
				tools: clientTools,
			},
		});

		cleanup.clients.push(client);

		await client.init({ name: 'sequential-tools-test' });

		const code = `
			const sum = await api.math.add({ a: 5, b: 3 });
			const product = await api.math.multiply({ a: sum.result, b: 2 });
			return { sum: sum.result, product: product.result };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		expect((result.result as any).sum).toBe(8);
		expect((result.result as any).product).toBe(16);
	});

	it('should handle mixed client tool calls with data processing', async () => {
		const clientTools: ClientTool[] = [
			{
				name: 'getData',
				description: 'Get data',
				inputSchema: {
					type: 'object',
					properties: {
						key: { type: 'string' },
					},
					required: ['key'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async (input: any) => {
					return { key: input.key, value: `data-${input.key}` };
				},
			},
			{
				name: 'processData',
				description: 'Process data',
				inputSchema: {
					type: 'object',
					properties: {
						data: { type: 'array' },
					},
					required: ['data'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async (input: any) => {
					return { count: input.data.length, processed: true };
				},
			},
		];

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
			serviceProviders: {
				tools: clientTools,
			},
		});

		cleanup.clients.push(client);

		await client.init({ name: 'mixed-tools-test' });

		const code = `
			const a = await api.client.getData({ key: 'A' });
			const b = await api.client.getData({ key: 'B' });
			const c = await api.client.getData({ key: 'C' });
			
			const processed = await api.client.processData({ data: [a, b, c] });
			
			return {
				items: [a.value, b.value, c.value],
				processed: processed.processed,
				count: processed.count
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		expect((result.result as any).items).toEqual(['data-A', 'data-B', 'data-C']);
		expect((result.result as any).processed).toBe(true);
		expect((result.result as any).count).toBe(3);
	});

	it('should handle errors in client tool gracefully', async () => {
		const clientTools: ClientTool[] = [
			{
				name: 'throwError',
				description: 'Tool that throws an error',
				inputSchema: {
					type: 'object',
					properties: {},
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async () => {
					throw new Error('Intentional error from client tool');
				},
			},
		];

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
			serviceProviders: {
				tools: clientTools,
			},
		});

		cleanup.clients.push(client);

		await client.init({ name: 'error-handling-test' });

		const code = `
			try {
				await api.client.throwError();
				return { caught: false };
			} catch (error) {
				return { caught: true, message: error.message };
			}
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		expect((result.result as any).caught).toBe(true);
		expect((result.result as any).message).toContain('Intentional error');
	});

	it('should maintain state across pause/resume cycles', async () => {
		const clientTools: ClientTool[] = [
			{
				name: 'getValue',
				description: 'Get a value',
				inputSchema: {
					type: 'object',
					properties: {
						multiplier: { type: 'number' },
					},
					required: ['multiplier'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async (input: any) => {
					return { value: 10 * input.multiplier };
				},
			},
		];

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
			serviceProviders: {
				tools: clientTools,
			},
		});

		cleanup.clients.push(client);

		await client.init({ name: 'state-persistence-test' });

		const code = `
			let accumulator = 0;
			
			const result1 = await api.client.getValue({ multiplier: 1 });
			accumulator += result1.value;
			
			const result2 = await api.client.getValue({ multiplier: 2 });
			accumulator += result2.value;
			
			const result3 = await api.client.getValue({ multiplier: 3 });
			accumulator += result3.value;
			
			return { accumulator, expected: 60 };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		expect((result.result as any).accumulator).toBe(60);
	});
});
