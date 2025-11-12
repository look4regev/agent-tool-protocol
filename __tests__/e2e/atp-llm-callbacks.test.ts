/**
 * E2E Test: ATP LLM Callbacks
 * Tests that atp.llm.call() works correctly with pause/resume
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@agent-tool-protocol/client';
import { AgentToolProtocolServer } from '@agent-tool-protocol/server';

const TEST_PORT = 3345;

describe('ATP LLM Callbacks E2E', () => {
	let client: AgentToolProtocolClient;
	let server: AgentToolProtocolServer;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-llm-callbacks';

		// Start server with compiler enabled (default)
		server = new AgentToolProtocolServer({
			execution: {
				timeout: 60000,
			},
		});
		await server.listen(TEST_PORT);

		// Create client
		client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
		});

		await client.init();
		await client.connect();
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		delete process.env.ATP_JWT_SECRET;
	});

	test('should handle single atp.llm.call()', async () => {
		client.provideLLM({
			call: async (prompt: string) => {
				return 'Hello World';
			},
		});

		const code = `
const result = await atp.llm.call({ prompt: 'Say hello in 2 words' });
return { success: true, response: result };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('success', true);
		expect(result.result).toHaveProperty('response');
		expect(result.stats.llmCallsCount).toBe(1);
	});

	test('should handle multiple sequential atp.llm.call()', async () => {
		client.provideLLM({
			call: async (prompt: string) => {
				if (prompt.includes('one')) return 'One';
				if (prompt.includes('two')) return 'Two';
				return 'Response';
			},
		});

		const code = `
const first = await atp.llm.call({ prompt: 'Say one' });
const second = await atp.llm.call({ prompt: 'Say two' });
return { first, second };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('first');
		expect(result.result).toHaveProperty('second');
		expect(result.stats.llmCallsCount).toBe(2);
	});

	test('should handle Promise.all with atp.llm.call (batch parallel)', async () => {
		let callCount = 0;
		const callLog: string[] = [];

		client.provideLLM({
			call: async (prompt: string) => {
				callCount++;
				callLog.push(`Call ${callCount}: ${prompt}`);
				console.log(`[TEST] LLM Call #${callCount}: ${prompt}`);
				// Mock LLM response
				const response = prompt.includes('A') ? 'A' : prompt.includes('B') ? 'B' : 'C';
				console.log(`[TEST] LLM Response #${callCount}: ${response}`);
				return response;
			},
		});

		const code = `
const results = await Promise.all([
  atp.llm.call({ prompt: 'Say A' }),
  atp.llm.call({ prompt: 'Say B' }),
  atp.llm.call({ prompt: 'Say C' })
]);
return { results, count: results.length };
		`;

		console.log('[TEST] Starting execution test...');
		const startTime = Date.now();

		const result = await client.execute(code);

		const duration = Date.now() - startTime;
		console.log(`[TEST] Execution completed in ${(duration / 1000).toFixed(2)}s`);
		console.log(`[TEST] Call count: ${callCount}`);

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('count', 3);
		expect(result.result).toHaveProperty('results');
		expect(Array.isArray((result.result as any).results)).toBe(true);
		expect(callCount).toBe(3);

		console.log(`✅ Promise.all with 3 LLM calls completed`);
	}, 180000);

	test('should handle errors in atp.llm.call()', async () => {
		client.provideLLM({
			call: async (prompt: string) => {
				if (prompt.includes('fail')) {
					throw new Error('LLM error: intentional failure');
				}
				return 'success';
			},
		});

		const code = `
const result = await atp.llm.call({ prompt: 'fail please' });
// ATP wraps errors in { __error: true, message: '...' }
if (result && typeof result === 'object' && result.__error) {
  return { failed: true, message: result.message };
}
return { failed: false, result };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('failed', true);
		expect(result.result).toHaveProperty('message');
		expect((result.result as any).message).toContain('LLM error');
	});
});
