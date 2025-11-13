import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { createServer } from '@mondaydotcomorg/atp-server';
import { LangGraphATPClient } from '@mondaydotcomorg/atp-langchain';
import { ChatOpenAI } from '@langchain/openai';

const PORT = 3531;

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

describe('LangGraph: LLM Operations', () => {
	let server: ReturnType<typeof createServer>;
	const createdClients: LangGraphATPClient[] = [];

	beforeAll(() => {
		process.env.ATP_JWT_SECRET = 'test-secret-llm-operations';
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

	it('should handle atp.llm.extract with structured output', async () => {
		server = createServer({
			execution: {
				timeout: 10000,
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
			useLangGraphInterrupts: false,
		});
		createdClients.push(client);

		await client.connect();

		const code = `
			const result = await atp.llm.extract(
				'User: John Doe, Age: 30, City: NYC',
				{ 
					type: 'object',
					properties: {
						name: { type: 'string' },
						age: { type: 'number' },
						city: { type: 'string' }
					}
				}
			);
			return result;
		`;

		const result = await client.execute(code);

		expect(result.result.status).toBe('completed');
		expect(result.result.result).toBeDefined();
		expect(typeof result.result.result).toBe('object');
	});

	it('should handle atp.llm.classify with categories', async () => {
		server = createServer({
			execution: {
				timeout: 10000,
				memory: 64 * 1024 * 1024,
				llmCalls: 10,
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
			const categories = ['positive', 'negative', 'neutral'];
			const category = await atp.llm.classify({
				text: 'This product is terrible!',
				categories
			});
			return { category, validCategories: categories };
		`;

		const result = await client.execute(code);

		expect(result.result.status).toBe('completed');
		expect((result.result.result as any).validCategories).toEqual([
			'positive',
			'negative',
			'neutral',
		]);
		const category = (result.result.result as any).category;
		expect(category).toBeDefined();
		if (typeof category === 'string') {
			expect(category.length).toBeGreaterThan(0);
		} else {
			expect(typeof category).toBe('object');
		}
	});

	it('should handle atp.llm.call with systemPrompt option', async () => {
		server = createServer({
			execution: {
				timeout: 10000,
				memory: 64 * 1024 * 1024,
				llmCalls: 10,
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
			const result = await atp.llm.call({
				prompt: 'What is 2+2?',
				systemPrompt: 'You are a math teacher. Always explain your reasoning.'
			});
			return { 
				result, 
				hasResult: !!result,
				resultType: typeof result
			};
		`;

		const result = await client.execute(code);

		expect(result.result.status).toBe('completed');
		expect((result.result.result as any).hasResult).toBe(true);
		expect(['string', 'object']).toContain((result.result.result as any).resultType);
	});

	it('should handle multiple LLM calls with pause/resume', async () => {
		server = createServer({
			execution: {
				timeout: 15000,
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
			useLangGraphInterrupts: false,
		});
		createdClients.push(client);

		await client.connect();

		const code = `
			const a1 = await atp.llm.call({ prompt: 'What is the capital of France?' });
			const a2 = await atp.llm.call({ prompt: 'What is 5 times 7?' });
			const a3 = await atp.llm.call({ prompt: 'Name a primary color' });
			return { a1, a2, a3 };
		`;

		const result = await client.execute(code);

		expect(result.result.status).toBe('completed');
		expect((result.result.result as any).a1).toBeDefined();
		expect((result.result.result as any).a2).toBeDefined();
		expect((result.result.result as any).a3).toBeDefined();
	});
});
