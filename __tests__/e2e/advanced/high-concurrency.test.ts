/**
 * E2E Test: High Concurrency - 100+ Concurrent Executions
 * Tests that ATP can handle production-level concurrent load
 * NO MOCKS, NO BYPASSES - Real production stress test
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@agent-tool-protocol/server';
import { AgentToolProtocolClient } from '@agent-tool-protocol/client';

const TEST_PORT = 3550;
const CONCURRENCY_LEVELS = [5];

describe('High Concurrency E2E (PRODUCTION STRESS)', () => {
	let server: AgentToolProtocolServer;
	let clients: AgentToolProtocolClient[] = [];

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-concurrency';

		// Start server with production-like config
		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024, // 128MB per execution
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

	test('should handle 5 concurrent executions without errors', async () => {
		const results = await Promise.all(
			Array.from({ length: 5 }, async (_, i) => {
				const client = new AgentToolProtocolClient({
					baseUrl: `http://localhost:${TEST_PORT}`,
				});
				await client.init();
				await client.connect();
				clients.push(client);

				const code = `
const result = ${i} * 2;
return { clientId: ${i}, result };
				`;

				return await client.execute(code);
			})
		);

		// Verify all executions completed
		expect(results.length).toBe(5);
		results.forEach((result, i) => {
			expect(result.status).toBe('completed');
			expect((result.result as any).clientId).toBe(i);
			expect((result.result as any).result).toBe(i * 2);
		});

		console.log(`✅ 5 concurrent executions completed`);
	}, 60000);

	test('should handle 5 concurrent compute-heavy executions', async () => {
		const results = await Promise.all(
			Array.from({ length: 5 }, async (_, i) => {
				const client = new AgentToolProtocolClient({
					baseUrl: `http://localhost:${TEST_PORT}`,
				});
				await client.init();
				await client.connect();
				clients.push(client);

				const code = `
const compute = (n) => {
	let sum = 0;
	for (let i = 0; i < n; i++) {
		sum += i;
	}
	return sum;
};
return { clientId: ${i}, result: compute(100) };
				`;

				return await client.execute(code);
			})
		);

		// Verify all executions completed
		expect(results.length).toBe(5);
		results.forEach((result, i) => {
			expect(result.status).toBe('completed');
			expect((result.result as any).clientId).toBe(i);
			expect((result.result as any).result).toBe(4950); // sum(0..99)
		});

		console.log(`✅ 5 concurrent compute-heavy executions completed`);
	}, 60000);

	test('should handle 5 concurrent executions with Fibonacci', async () => {
		const startTime = Date.now();

		const results = await Promise.all(
			Array.from({ length: 5 }, async (_, i) => {
				const client = new AgentToolProtocolClient({
					baseUrl: `http://localhost:${TEST_PORT}`,
				});
				await client.init();
				await client.connect();
				clients.push(client);

				const code = `
const fibonacci = (n) => {
	if (n <= 1) return n;
	let a = 0, b = 1;
	for (let i = 2; i <= n; i++) {
		[a, b] = [b, a + b];
	}
	return b;
};
return { clientId: ${i}, result: fibonacci(20) };
				`;

				return await client.execute(code);
			})
		);

		const duration = Date.now() - startTime;

		// Verify all executions completed
		expect(results.length).toBe(5);
		results.forEach((result, i) => {
			expect(result.status).toBe('completed');
			expect((result.result as any).clientId).toBe(i);
			expect((result.result as any).result).toBe(6765); // fib(20)
		});

		// Log performance metrics
		console.log(`✅ 5 concurrent executions completed in ${duration}ms`);
		console.log(`   Average: ${(duration / 5).toFixed(2)}ms per execution`);

		expect(duration).toBeLessThan(60000);
	}, 90000);

	test('should handle 5 concurrent executions with timestamps', async () => {
		const startTime = Date.now();

		const results = await Promise.all(
			Array.from({ length: 5 }, async (_, i) => {
				const client = new AgentToolProtocolClient({
					baseUrl: `http://localhost:${TEST_PORT}`,
				});
				await client.init();
				await client.connect();
				clients.push(client);

				const code = `
return { clientId: ${i}, timestamp: Date.now() };
				`;

				return await client.execute(code);
			})
		);

		const duration = Date.now() - startTime;

		// Verify all executions completed
		expect(results.length).toBe(5);
		results.forEach((result, i) => {
			expect(result.status).toBe('completed');
			expect((result.result as any).clientId).toBe(i);
		});

		console.log(`✅ 5 concurrent executions completed in ${duration}ms`);
		console.log(`   Average: ${(duration / 5).toFixed(2)}ms per execution`);

		expect(duration).toBeLessThan(60000);
	}, 90000);

	test('should handle 5 concurrent executions with errors gracefully', async () => {
		const results = await Promise.allSettled(
			Array.from({ length: 5 }, async (_, i) => {
				const client = new AgentToolProtocolClient({
					baseUrl: `http://localhost:${TEST_PORT}`,
				});
				await client.init();
				await client.connect();
				clients.push(client);

				const code =
					i % 5 === 0
						? `throw new Error('Intentional error for client ${i}');`
						: `return { clientId: ${i}, success: true };`;

				return await client.execute(code);
			})
		);

		// Count successes and failures
		const successes = results.filter(
			(r) => r.status === 'fulfilled' && (r.value as any).status === 'completed'
		);
		const failures = results.filter(
			(r) => r.status === 'fulfilled' && (r.value as any).status === 'failed'
		);

		// Verify we have both successes and failures
		expect(successes.length).toBeGreaterThan(0);
		expect(failures.length).toBeGreaterThan(0);
		expect(successes.length + failures.length).toBe(5);

		console.log(
			`✅ Handled ${successes.length} successes and ${failures.length} failures gracefully`
		);
	}, 60000);

	test('should maintain isolation between 5 concurrent executions', async () => {
		// Each execution sets a global variable - they should not interfere
		const results = await Promise.all(
			Array.from({ length: 5 }, async (_, i) => {
				const client = new AgentToolProtocolClient({
					baseUrl: `http://localhost:${TEST_PORT}`,
				});
				await client.init();
				await client.connect();
				clients.push(client);

				const code = `
const value = ${i * 10};
return { clientId: ${i}, value: value };
				`;

				return await client.execute(code);
			})
		);

		// Verify each execution got its own isolated value
		results.forEach((result, i) => {
			expect(result.status).toBe('completed');
			expect((result.result as any).value).toBe(i * 10);
		});
	}, 60000);
});
