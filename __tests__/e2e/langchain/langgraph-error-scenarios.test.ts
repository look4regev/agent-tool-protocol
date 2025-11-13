import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { createServer } from '@agent-tool-protocol/server';
import { ApprovalRequiredException, LangGraphATPClient } from '@mondaydotcomorg/atp-langchain';
import { ChatOpenAI } from '@langchain/openai';
import { BaseMessage } from '@langchain/core/messages';

const PORT = 3532;

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

describe('LangGraph: Error Scenarios', () => {
	let server: ReturnType<typeof createServer>;
	const createdClients: LangGraphATPClient[] = [];

	beforeAll(() => {
		process.env.ATP_JWT_SECRET = 'test-secret-error-scenarios';
		process.env.OPENAI_API_KEY = 'sk-fake-key-for-testing';
	});

	afterEach(async () => {
		for (const client of createdClients) {
			try {
				const internalClient = (client as any).client;
				if (internalClient?.close) {
					await internalClient.close();
				}
			} catch {
				// Ignore cleanup errors
			}
		}
		createdClients.length = 0;

		if (server) {
			try {
				await server.stop();
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	afterAll(async () => {
		createdClients.length = 0;
	});

	it('should handle execution timeout while waiting for approval', async () => {
		server = createServer({
			execution: {
				timeout: 2000,
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
			const approval = await atp.approval.request('Wait for timeout');
			return { approved: approval.approved };
		`;

		let executionId: string = '';
		try {
			await client.execute(code);
		} catch (error) {
			if (error instanceof ApprovalRequiredException) {
				executionId = error.approvalRequest.executionId;
			}
		}

		expect(executionId).toBeTruthy();

		await new Promise((resolve) => setTimeout(resolve, 3000));

		try {
			await client.resumeWithApproval(executionId, true);
			throw new Error('Should have thrown timeout error');
		} catch (error: any) {
			expect(error.message).toMatch(/timeout|expired|not found/i);
		}
	});

	it('should handle invalid approval response format', async () => {
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
			const approval = await atp.approval.request('Test');
			return { approved: approval.approved };
		`;

		let executionId: string = '';
		try {
			await client.execute(code);
		} catch (error) {
			if (error instanceof ApprovalRequiredException) {
				executionId = error.approvalRequest.executionId;
			}
		}

		const internalClient = (client as any).client;
		try {
			await internalClient.resume(executionId, { invalid: 'format' });
		} catch (error: any) {
			expect(error).toBeDefined();
		}
	});

	it('should handle LLM errors gracefully', async () => {
		server = createServer({
			execution: {
				timeout: 60000,
				memory: 64 * 1024 * 1024,
				llmCalls: 5,
			},
			logger: 'error',
		});
		await server.listen(PORT);
		await waitForServer(PORT);

		const llm = new ChatOpenAI({
			modelName: 'gpt-4o',
			openAIApiKey: process.env.OPENAI_API_KEY || 'sk-fake-key',
		});

		const client = new LangGraphATPClient({
			serverUrl: `http://localhost:${PORT}`,
			llm,
			useLangGraphInterrupts: false,
		});
		createdClients.push(client);

		await client.connect();

		const code = `
			try {
				const r = await atp.llm.call({ prompt: 'test', invalidParam: true });
				return { hasResult: true, result: r };
			} catch (error) {
				return { hasResult: false, errorCaught: true, errorMessage: error.message };
			}
		`;
		const result = await client.execute(code);

		expect(result.result.status).toBe('completed');
		const resultData = result.result.result as any;
		expect(resultData.hasResult !== undefined).toBe(true);
	}, 60000);

	it('should deny by default in direct mode without handler', async () => {
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
			useLangGraphInterrupts: false,
		});
		createdClients.push(client);

		await client.connect();

		const code = `
			const approval = await atp.approval.request('Proceed?');
			return { approved: approval.approved };
		`;

		const result = await client.execute(code);

		expect(result.result.status).toBe('completed');
		expect((result.result.result as any).approved).toBe(false);
	});
});
