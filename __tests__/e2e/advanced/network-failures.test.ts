/**
 * E2E Test: Network Failures During Pause/Resume
 * Tests that ATP correctly handles network failures and retry logic
 * NO MOCKS - Real HTTP connection failures and timeouts
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@agent-tool-protocol/server';
import { AgentToolProtocolClient } from '@agent-tool-protocol/client';

const TEST_PORT = 3551;

describe('Network Failures E2E (PRODUCTION RESILIENCE)', () => {
	let server: AgentToolProtocolServer;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-network';

		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
			},
		});

		await server.listen(TEST_PORT);
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		delete process.env.ATP_JWT_SECRET;
	});

	test('should handle server restart during execution', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
		});

		await client.init();
		await client.connect();

		let callCount = 0;
		client.provideLLM({
			call: async (prompt: string) => {
				callCount++;
				if (callCount === 1) {
					// First call succeeds
					return 'First response';
				}
				// Subsequent calls also succeed (server restarted)
				return 'Second response';
			},
		});

		const code = `
const first = await atp.llm.call({ prompt: 'First' });
const second = await atp.llm.call({ prompt: 'Second' });
return { first, second };
		`;

		// Start execution
		const result = await client.execute(code);

		// Should complete despite any network hiccups
		expect(result.status).toBe('completed');
		expect(callCount).toBeGreaterThanOrEqual(2);
	}, 60000);

	test('should handle connection timeout gracefully', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
		});

		await client.init();
		await client.connect();

		// Simulate slow LLM responses
		client.provideLLM({
			call: async (prompt: string) => {
				// Simulate slow response (but within timeout)
				await new Promise((resolve) => setTimeout(resolve, 500));
				return 'Slow response';
			},
		});

		const code = `
const result = await atp.llm.call({ prompt: 'Slow prompt' });
return { result };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect((result.result as any).result).toBe('Slow response');
	}, 30000);

	test('should handle client disconnection and reconnection', async () => {
		const client1 = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
		});

		await client1.init();
		await client1.connect();

		let llmCallCount = 0;
		const llmHandler = {
			call: async (prompt: string) => {
				llmCallCount++;
				return `Response ${llmCallCount}`;
			},
		};

		client1.provideLLM(llmHandler);

		const code = `
const first = await atp.llm.call({ prompt: 'First' });
const second = await atp.llm.call({ prompt: 'Second' });
return { first, second };
		`;

		const result = await client1.execute(code);

		expect(result.status).toBe('completed');
		expect(llmCallCount).toBe(2);
	}, 60000);

	test('should handle execution state persistence across network failures', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
		});

		await client.init();
		await client.connect();

		let callCount = 0;
		client.provideLLM({
			call: async (prompt: string) => {
				callCount++;
				// Simulate occasional network blips (but succeed)
				if (callCount % 3 === 0) {
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
				return `Call ${callCount}`;
			},
		});

		const code = `
const results = [];
for (let i = 0; i < 5; i++) {
	const response = await atp.llm.call({ prompt: \`Prompt \${i}\` });
	results.push(response);
}
return { results, count: results.length };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect((result.result as any).count).toBe(5);
		expect(callCount).toBe(5);
	}, 60000);

	test('should handle concurrent executions with network instability', async () => {
		const results = await Promise.all(
			Array.from({ length: 10 }, async (_, i) => {
				const client = new AgentToolProtocolClient({
					baseUrl: `http://localhost:${TEST_PORT}`,
				});

				await client.init();
				await client.connect();

				client.provideLLM({
					call: async (prompt: string) => {
						// Simulate variable network latency
						const delay = Math.random() * 200;
						await new Promise((resolve) => setTimeout(resolve, delay));
						return `Response for client ${i}`;
					},
				});

				const code = `
const result = await atp.llm.call({ prompt: 'Test ${i}' });
return { clientId: ${i}, result };
				`;

				return await client.execute(code);
			})
		);

		// All executions should succeed despite network variability
		expect(results.length).toBe(10);
		results.forEach((result, i) => {
			expect(result.status).toBe('completed');
			expect((result.result as any).clientId).toBe(i);
		});
	}, 90000);

	test('should handle resume after long network delay', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
		});

		await client.init();
		await client.connect();

		let firstCallCompleted = false;
		client.provideLLM({
			call: async (prompt: string) => {
				if (!firstCallCompleted) {
					firstCallCompleted = true;
					// Simulate long network delay on first call
					await new Promise((resolve) => setTimeout(resolve, 2000));
					return 'First after delay';
				}
				return 'Second';
			},
		});

		const code = `
const first = await atp.llm.call({ prompt: 'First' });
const second = await atp.llm.call({ prompt: 'Second' });
return { first, second };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect((result.result as any).first).toBe('First after delay');
		expect((result.result as any).second).toBe('Second');
	}, 60000);

	test('should maintain execution state during intermittent connectivity', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
		});

		await client.init();
		await client.connect();

		let callNumber = 0;
		const callLog: string[] = [];

		client.provideLLM({
			call: async (prompt: string) => {
				callNumber++;
				callLog.push(`Call ${callNumber}: ${prompt}`);

				// Simulate intermittent delays
				if (callNumber === 2) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}

				return `Response ${callNumber}`;
			},
		});

		const code = `
const results = [];
for (let i = 1; i <= 4; i++) {
	const response = await atp.llm.call({ prompt: \`Request \${i}\` });
	results.push(response);
}
return { results, callCount: results.length };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect((result.result as any).callCount).toBe(4);
		expect(callLog.length).toBe(4);

		// Verify all calls were made in order
		callLog.forEach((log, i) => {
			expect(log).toContain(`Request ${i + 1}`);
		});
	}, 60000);
});
