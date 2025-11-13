import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ChatOpenAI } from '@langchain/openai';
import { LangGraphATPClient } from '@mondaydotcomorg/atp-langchain';
import type { ClientTool } from '@agent-tool-protocol/protocol';
import { ExecutionStatus, ToolOperationType } from '@agent-tool-protocol/protocol';
import {
	createTestATPServer,
	createCleanupTracker,
	cleanupAll,
	type TestServer,
	type CleanupTracker,
} from '../infrastructure/test-helpers';

describe('LangGraph: Client Tools Integration', () => {
	let atpServer: TestServer;
	let cleanup: CleanupTracker;
	const createdClients: LangGraphATPClient[] = [];

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-langgraph-client-tools';
		process.env.OPENAI_API_KEY = 'sk-fake-key-for-testing';
		cleanup = createCleanupTracker();

		await new Promise((resolve) => setTimeout(resolve, 500));

		atpServer = await createTestATPServer({
			execution: {
				timeout: 60000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
			},
		});

		cleanup.servers.push(atpServer);
	}, 70000);

	afterAll(async () => {
		for (const client of createdClients) {
			try {
				const internalClient = (client as any).client;
				if (internalClient) {
					(internalClient as any).serviceProviders = null;
				}
			} catch (e) {
				// Ignore
			}
		}
		createdClients.length = 0;

		await cleanupAll(cleanup);
	});

	it('should execute client tools through LangGraph', async () => {
		const clientTools: ClientTool[] = [
			{
				name: 'calculate',
				description: 'Perform calculation',
				inputSchema: {
					type: 'object',
					properties: {
						operation: { type: 'string' },
						a: { type: 'number' },
						b: { type: 'number' },
					},
					required: ['operation', 'a', 'b'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async (input: any) => {
					const { operation, a, b } = input;
					switch (operation) {
						case 'add':
							return { result: a + b };
						case 'multiply':
							return { result: a * b };
						default:
							throw new Error(`Unknown operation: ${operation}`);
					}
				},
			},
		];

		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
			tools: clientTools,
			useLangGraphInterrupts: false,
		});

		createdClients.push(client);

		await client.connect();

		const code = `
			const sum = await api.client.calculate({ operation: 'add', a: 5, b: 3 });
			const product = await api.client.calculate({ operation: 'multiply', a: 4, b: 7 });
			
			return {
				sum: sum.result,
				product: product.result
			};
		`;

		const result = await client.execute(code);

		expect(result.result.status).toBe('completed');
		expect((result.result.result as any).sum).toBe(8);
		expect((result.result.result as any).product).toBe(28);
	});

	it('should handle LLM sampling through LangGraph client', async () => {
		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
			useLangGraphInterrupts: false,
		});

		createdClients.push(client);

		await client.connect();

		const code = `
			const analysis = await atp.llm.call({
				prompt: 'What is 2 + 2?'
			});

			return {
				hasAnalysis: !!analysis,
				analysisType: typeof analysis
			};
		`;

		const result = await client.execute(code);

		expect(result.result.status).toBe('completed');
		expect((result.result.result as any).hasAnalysis).toBe(true);
		expect(['string', 'object']).toContain((result.result.result as any).analysisType);
	}, 60000);

	it('should handle approval workflows with LangGraph', async () => {
		let approvalCalled = false;

		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
			useLangGraphInterrupts: false,
			approvalHandler: async (message) => {
				approvalCalled = true;
				return true;
			},
		});

		createdClients.push(client);

		await client.connect();

		const code = `
			const approval = await atp.approval.request(
				'Approve this operation?',
				{ operation: 'test' }
			);
			
			return {
				approved: approval.approved,
				approvalCalled: true
			};
		`;

		const result = await client.execute(code);

		expect(result.result.status).toBe('completed');
		expect((result.result.result as any).approved).toBe(true);
		expect(approvalCalled).toBe(true);
	});

	it('should handle multiple client tool calls with state preservation', async () => {
		const clientTools: ClientTool[] = [
			{
				name: 'storeValue',
				description: 'Store a value',
				inputSchema: {
					type: 'object',
					properties: {
						key: { type: 'string' },
						value: { type: 'number' },
					},
					required: ['key', 'value'],
				},
				metadata: {
					operationType: ToolOperationType.WRITE,
				},
				handler: async (input: any) => {
					return { stored: true, key: input.key, value: input.value };
				},
			},
		];

		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
			tools: clientTools,
			useLangGraphInterrupts: false,
		});

		createdClients.push(client);

		await client.connect();

		const code = `
			const store1 = await api.client.storeValue({ key: 'a', value: 10 });
			const store2 = await api.client.storeValue({ key: 'b', value: 20 });
			const store3 = await api.client.storeValue({ key: 'c', value: 30 });
			
			return {
				allStored: store1.stored && store2.stored && store3.stored,
				sum: store1.value + store2.value + store3.value
			};
		`;

		const result = await client.execute(code);

		expect(result.result.status).toBe('completed');
		expect((result.result.result as any).allStored).toBe(true);
		expect((result.result.result as any).sum).toBe(60);
	});
});
