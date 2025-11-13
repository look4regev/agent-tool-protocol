import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { createServer } from '@mondaydotcomorg/atp-server';
import { ApprovalRequiredException, LangGraphATPClient } from '@mondaydotcomorg/atp-langchain';
import { ChatOpenAI } from '@langchain/openai';

const PORT = 3530;

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

describe('LangGraph: Mixed Callback Workflows', () => {
	let server: ReturnType<typeof createServer>;
	const createdClients: LangGraphATPClient[] = [];

	beforeAll(() => {
		process.env.ATP_JWT_SECRET = 'test-secret-mixed-callbacks';
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

	it('should handle LLM call followed by approval request', async () => {
		server = createServer({
			execution: {
				timeout: 60000,
				memory: 64 * 1024 * 1024,
				llmCalls: 10,
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
			const analysis = await atp.llm.call({ prompt: 'Analyze risk: medium level' });
			const approval = await atp.approval.request('Proceed with action?', { analysis });
			return { analysis, approved: approval.approved };
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
		expect(approvalException!.approvalRequest.message).toBe('Proceed with action?');
		expect(approvalException!.approvalRequest.context).toHaveProperty('analysis');

		const executionId = approvalException!.approvalRequest.executionId;
		const result = await client.resumeWithApproval(executionId, true, 'Go ahead');

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('analysis');
		expect((result.result as any).approved).toBe(true);
	}, 120000);

	it('should handle approval followed by LLM call', async () => {
		server = createServer({
			execution: {
				timeout: 60000,
				memory: 64 * 1024 * 1024,
				llmCalls: 10,
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
			const approval = await atp.approval.request('Start processing?');
			if (!approval.approved) return { cancelled: true };

			const result = await atp.llm.call({ prompt: 'Process the data and return summary' });
			return { result, approved: true };
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
		expect(approvalException!.approvalRequest.message).toBe('Start processing?');

		const executionId = approvalException!.approvalRequest.executionId;
		const result = await client.resumeWithApproval(executionId, true);

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('result');
		expect((result.result as any).approved).toBe(true);
	}, 60000);

	it('should handle LLM -> Approval -> LLM -> Approval workflow', async () => {
		server = createServer({
			execution: {
				timeout: 60000,
				memory: 64 * 1024 * 1024,
				llmCalls: 10,
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
			const plan = await atp.llm.call({ prompt: 'Create a plan for deployment' });
			const approval1 = await atp.approval.request('Approve deployment plan?', { plan });
			if (!approval1.approved) return { stopped: 'planning' };

			const execution = await atp.llm.call({ prompt: 'Execute the deployment plan' });
			const approval2 = await atp.approval.request('Confirm deployment results?', { execution });

			return { plan, execution, approved: approval2.approved };
		`;

		let approval1Exception: ApprovalRequiredException | null = null;
		try {
			await client.execute(code);
		} catch (error) {
			if (error instanceof ApprovalRequiredException) {
				approval1Exception = error;
			} else {
				throw error;
			}
		}

		expect(approval1Exception).not.toBeNull();
		expect(approval1Exception!.approvalRequest.message).toBe('Approve deployment plan?');
		expect(approval1Exception!.approvalRequest.context).toHaveProperty('plan');

		const executionId1 = approval1Exception!.approvalRequest.executionId;

		let approval2Exception: ApprovalRequiredException | null = null;
		try {
			await client.resumeWithApproval(executionId1, true, 'Plan approved');
		} catch (error) {
			if (error instanceof ApprovalRequiredException) {
				approval2Exception = error;
			} else {
				throw error;
			}
		}

		expect(approval2Exception).not.toBeNull();
		expect(approval2Exception!.approvalRequest.message).toBe('Confirm deployment results?');
		expect(approval2Exception!.approvalRequest.context).toHaveProperty('execution');

		const executionId2 = approval2Exception!.approvalRequest.executionId;
		const finalResult = await client.resumeWithApproval(executionId2, true, 'Results confirmed');

		expect(finalResult.status).toBe('completed');
		expect(finalResult.result).toHaveProperty('plan');
		expect(finalResult.result).toHaveProperty('execution');
		expect((finalResult.result as any).approved).toBe(true);
	}, 60000);
});
