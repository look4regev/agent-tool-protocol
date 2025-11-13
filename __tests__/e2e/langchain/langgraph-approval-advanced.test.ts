import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { createServer } from '@mondaydotcomorg/atp-server';
import { ApprovalRequiredException, LangGraphATPClient } from '@mondaydotcomorg/atp-langchain';
import { ChatOpenAI } from '@langchain/openai';

const PORT = 3529;

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

describe('LangGraph: Approval Advanced Scenarios', () => {
	let server: ReturnType<typeof createServer>;
	const createdClients: LangGraphATPClient[] = [];

	beforeAll(() => {
		process.env.ATP_JWT_SECRET = 'test-secret-approval-advanced';
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

	it('should handle multiple sequential approval requests with interrupts', async () => {
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
			const approval1 = await atp.approval.request('Step 1?', { step: 1 });
			if (!approval1.approved) return { stopped: 'step1' };
			
			const approval2 = await atp.approval.request('Step 2?', { step: 2 });
			if (!approval2.approved) return { stopped: 'step2' };
			
			const approval3 = await atp.approval.request('Step 3?', { step: 3 });
			return { completed: approval3.approved, steps: 3 };
		`;

		let exception1: ApprovalRequiredException | null = null;
		try {
			await client.execute(code);
		} catch (error) {
			if (error instanceof ApprovalRequiredException) {
				exception1 = error;
			} else {
				throw error;
			}
		}

		expect(exception1).not.toBeNull();
		expect(exception1!.approvalRequest.message).toBe('Step 1?');
		expect(exception1!.approvalRequest.context).toEqual({ step: 1 });

		const executionId1 = exception1!.approvalRequest.executionId;

		let exception2: ApprovalRequiredException | null = null;
		try {
			await client.resumeWithApproval(executionId1, true, 'Approved step 1');
		} catch (error) {
			if (error instanceof ApprovalRequiredException) {
				exception2 = error;
			} else {
				throw error;
			}
		}

		expect(exception2).not.toBeNull();
		expect(exception2!.approvalRequest.message).toBe('Step 2?');
		expect(exception2!.approvalRequest.context).toEqual({ step: 2 });

		const executionId2 = exception2!.approvalRequest.executionId;

		let exception3: ApprovalRequiredException | null = null;
		try {
			await client.resumeWithApproval(executionId2, true, 'Approved step 2');
		} catch (error) {
			if (error instanceof ApprovalRequiredException) {
				exception3 = error;
			} else {
				throw error;
			}
		}

		expect(exception3).not.toBeNull();
		expect(exception3!.approvalRequest.message).toBe('Step 3?');
		expect(exception3!.approvalRequest.context).toEqual({ step: 3 });

		const executionId3 = exception3!.approvalRequest.executionId;
		const finalResult = await client.resumeWithApproval(executionId3, true, 'Approved step 3');

		expect(finalResult.status).toBe('completed');
		expect(finalResult.result).toEqual({ completed: true, steps: 3 });
	});

	it('should validate executionId exists in approval context', async () => {
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

		const internalClient = (client as any).client;
		const handleApprovalRequest = (client as any).handleApprovalRequest.bind(client);

		try {
			await handleApprovalRequest('Test message', { someData: 'value' });
			throw new Error('Should have thrown error for missing executionId');
		} catch (error: any) {
			expect(error.message).toContain('executionId is missing');
		}
	});

	it('should reject resume with non-existent executionId', async () => {
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

		try {
			await client.resumeWithApproval('fake-execution-id-12345', true);
			throw new Error('Should have thrown error');
		} catch (error: any) {
			expect(error.message).toMatch(/not found|expired|invalid/i);
		}
	});

	it('should track and clean up pending approvals', async () => {
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
			const approval = await atp.approval.request('Track this', { data: 'test' });
			return { approved: approval.approved };
		`;

		let exception: ApprovalRequiredException | null = null;
		try {
			await client.execute(code);
		} catch (error) {
			if (error instanceof ApprovalRequiredException) {
				exception = error;
			} else {
				throw error;
			}
		}

		expect(exception).not.toBeNull();
		const executionId = exception!.approvalRequest.executionId;

		const pending = client.getPendingApproval(executionId);
		expect(pending).toBeDefined();
		expect(pending!.message).toBe('Track this');
		expect(pending!.context).toEqual({ data: 'test' });

		await client.resumeWithApproval(executionId, true);

		const afterResume = client.getPendingApproval(executionId);
		expect(afterResume).toBeUndefined();
	});
});
