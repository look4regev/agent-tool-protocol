import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { createServer } from '@agent-tool-protocol/server';
import { ApprovalRequiredException, LangGraphATPClient } from '@agent-tool-protocol/langchain';
import type { ClientTool } from '@agent-tool-protocol/protocol';
import { ToolOperationType } from '@agent-tool-protocol/protocol';
import { ChatOpenAI } from '@langchain/openai';

const PORT = 3528;

async function waitForServer(port: number, maxAttempts = 30): Promise<void> {
	for (let i = 0; i < maxAttempts; i++) {
		try {
			const response = await fetch(`http://localhost:${port}/api/definitions`);
			if (response.ok) return;
		} catch {
			// Server not ready
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`Server on port ${port} did not start in time`);
}

describe('LangChain Client Tools Integration', () => {
	let server: ReturnType<typeof createServer>;
	const createdClients: LangGraphATPClient[] = [];

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
	];

	beforeAll(() => {
		process.env.ATP_JWT_SECRET = 'test-secret-for-langchain';
		process.env.OPENAI_API_KEY = 'sk-fake-key-for-testing';
	});

	afterEach(async () => {
		// Clean up clients - LangGraphATPClient uses internal client.close()
		for (const client of createdClients) {
			try {
				// Access internal client for cleanup
				const internalClient = (client as any).client;
				if (internalClient?.close) {
					await internalClient.close();
				}
			} catch {
				// Ignore cleanup errors
			}
		}
		createdClients.length = 0;

		// Stop server after each test
		if (server) {
			try {
				await server.stop();
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	afterAll(async () => {
		// Final cleanup
		createdClients.length = 0;
	});

	it('should execute client tool via LangChain adapter', async () => {
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

		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${PORT}`,
			llm,
			tools: testTools,
			useLangGraphInterrupts: false,
		});
		createdClients.push(client);

		await client.connect();

		const code = `const result = await api.math.add({ a: 10, b: 5 }); return result;`;
		const execResult = await client.execute(code);

		expect(execResult.result.status).toBe('completed');
		expect(execResult.result.result).toEqual({ result: 15 });
	});

	it('should handle multiple client tool calls via LangChain', async () => {
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

		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${PORT}`,
			llm,
			tools: testTools,
			useLangGraphInterrupts: false,
		});
		createdClients.push(client);

		await client.connect();

		const code = `
			const sum = await api.math.add({ a: 7, b: 3 });
			const text = await api.string.concat({ str1: 'Hello', str2: ' LangChain' });
			
			return {
				sum: sum.result,
				text: text.result,
			};
		`;

		const execResult = await client.execute(code);

		expect(execResult.result.status).toBe('completed');
		expect((execResult.result.result as any).sum).toBe(10);
		expect((execResult.result.result as any).text).toBe('Hello LangChain');
	});

	it('should work without client tools', async () => {
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

		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		// No tools provided
		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${PORT}`,
			llm,
			useLangGraphInterrupts: false,
		});
		createdClients.push(client);

		await client.connect();

		const code = `return { message: 'No tools needed' };`;
		const execResult = await client.execute(code);

		expect(execResult.result.status).toBe('completed');
		expect(execResult.result.result).toEqual({ message: 'No tools needed' });
	});

	it('should throw ApprovalRequiredException when approval is requested with useLangGraphInterrupts=true', async () => {
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

		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${PORT}`,
			llm,
			useLangGraphInterrupts: true,
		});
		createdClients.push(client);

		await client.connect();

		const code = `
			const data = { step: 1, value: 42 };
			const approval = await atp.approval.request('Approve this action?', { 
				action: 'process_data',
				data 
			});
			return { approved: approval.approved, data };
		`;

		let caughtException: ApprovalRequiredException | null = null;

		try {
			await client.execute(code);
		} catch (error) {
			if (error instanceof ApprovalRequiredException) {
				caughtException = error;
			} else {
				throw error;
			}
		}

		expect(caughtException).not.toBeNull();
		expect(caughtException?.approvalRequest).toBeDefined();
		expect(caughtException?.approvalRequest.message).toBe('Approve this action?');
		expect(caughtException?.approvalRequest.context).toEqual({
			action: 'process_data',
			data: { step: 1, value: 42 },
		});
		expect(caughtException?.approvalRequest.executionId).toBeDefined();
		expect(caughtException?.approvalRequest.timestamp).toBeDefined();
		expect(caughtException?.name).toBe('ApprovalRequiredException');
	});

	it('should resume execution after approval with ApprovalRequiredException', async () => {
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

		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${PORT}`,
			llm,
			useLangGraphInterrupts: true,
		});
		createdClients.push(client);

		await client.connect();

		const code = `
			const step1 = { processed: true };
			const approval = await atp.approval.request('Continue to step 2?', { step1 });
			
			if (approval.approved) {
				return { step1, step2: 'completed', approved: true };
			} else {
				return { step1, step2: 'skipped', approved: false };
			}
		`;

		let approvalException: ApprovalRequiredException | null = null;

		try {
			await client.execute(code);
		} catch (error) {
			if (error instanceof ApprovalRequiredException) {
				approvalException = error;
			} else {
				throw error;
			}
		}

		expect(approvalException).not.toBeNull();
		const executionId = approvalException!.approvalRequest.executionId;

		const resumeResult = await client.resumeWithApproval(executionId, true, 'Approved by test');

		expect(resumeResult.status).toBe('completed');
		expect(resumeResult.result).toEqual({
			step1: { processed: true },
			step2: 'completed',
			approved: true,
		});
	});

	it('should handle approval denial correctly', async () => {
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

		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${PORT}`,
			llm,
			useLangGraphInterrupts: true,
		});
		createdClients.push(client);

		await client.connect();

		const code = `
			const approval = await atp.approval.request('Proceed with deletion?', { 
				operation: 'delete',
				critical: true 
			});
			
			if (approval.approved) {
				return { deleted: true };
			} else {
				return { deleted: false, reason: approval.reason || 'denied' };
			}
		`;

		let approvalException: ApprovalRequiredException | null = null;

		try {
			await client.execute(code);
		} catch (error) {
			if (error instanceof ApprovalRequiredException) {
				approvalException = error;
			} else {
				throw error;
			}
		}

		expect(approvalException).not.toBeNull();
		const executionId = approvalException!.approvalRequest.executionId;

		const resumeResult = await client.resumeWithApproval(executionId, false, 'Too risky');

		expect(resumeResult.status).toBe('completed');
		expect(resumeResult.result).toEqual({
			deleted: false,
			reason: 'Too risky',
		});
	});
});
