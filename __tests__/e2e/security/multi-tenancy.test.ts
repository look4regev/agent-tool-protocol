/**
 * E2E tests for multi-tenancy cache isolation
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import fetch from 'node-fetch';

const TEST_PORT = 3501;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe('Multi-Tenancy Cache Isolation E2E', () => {
	let server: AgentToolProtocolServer;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-multi-tenancy';

		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
			},
		});

		await server.listen(TEST_PORT);
		await new Promise((resolve) => setTimeout(resolve, 500));
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		delete process.env.ATP_JWT_SECRET;
		await new Promise((resolve) => setTimeout(resolve, 500));
	});

	// Helper functions
	async function initClient(name: string) {
		const response = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name } }),
		});
		return await response.json();
	}

	async function execute(clientId: string, token: string, code: string) {
		const response = await fetch(`${BASE_URL}/api/execute`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({ code }),
		});
		return await response.json();
	}

	test('should isolate cache between different clients', async () => {
		// Create two separate clients
		const { clientId: client1Id, token: token1 } = await initClient('client1');
		const { clientId: client2Id, token: token2 } = await initClient('client2');

		// Client 1 sets a cache value
		const code1 = `
			await atp.cache.set('shared-key', 'client-1-value', 60);
			return await atp.cache.get('shared-key');
		`;

		// Client 2 sets the same cache key
		const code2 = `
			await atp.cache.set('shared-key', 'client-2-value', 60);
			return await atp.cache.get('shared-key');
		`;

		// Execute on both clients
		const [result1, result2] = await Promise.all([
			execute(client1Id, token1, code1),
			execute(client2Id, token2, code2),
		]);

		expect(result1.status).toBe('completed');
		expect(result2.status).toBe('completed');

		// Each client should see their own value due to cache key prefixing
		expect(result1.result).toBe('client-1-value');
		expect(result2.result).toBe('client-2-value');
	});

	test('should maintain cache isolation across multiple operations', async () => {
		const { clientId: client1Id, token: token1 } = await initClient('isolated1');
		const { clientId: client2Id, token: token2 } = await initClient('isolated2');

		// Client 1 operations
		const code1 = `
			await atp.cache.set('key1', 'value1', 60);
			await atp.cache.set('key2', 'value2', 60);
			const hasKey1 = await atp.cache.has('key1');
			const hasKey2 = await atp.cache.has('key2');
			return { hasKey1, hasKey2 };
		`;

		// Client 2 tries to access client 1's keys
		const code2 = `
			const hasKey1 = await atp.cache.has('key1');
			const hasKey2 = await atp.cache.has('key2');
			return { hasKey1, hasKey2 };
		`;

		const result1 = await execute(client1Id, token1, code1);
		const result2 = await execute(client2Id, token2, code2);

		expect(result1.status).toBe('completed');
		expect(result1.result).toEqual({ hasKey1: true, hasKey2: true });

		// Client 2 should NOT see client 1's keys
		expect(result2.status).toBe('completed');
		expect(result2.result).toEqual({ hasKey1: false, hasKey2: false });
	});

	test('should not allow cache key collisions between clients', async () => {
		const { clientId: client1Id, token: token1 } = await initClient('collision1');
		const { clientId: client2Id, token: token2 } = await initClient('collision2');

		// Both clients use identical cache keys
		const setCacheCode = (value: string) => `
			await atp.cache.set('same-key', '${value}', 60);
			return 'set';
		`;

		const getCacheCode = `
			return await atp.cache.get('same-key');
		`;

		// Client 1 sets value
		await execute(client1Id, token1, setCacheCode('client1-data'));

		// Client 2 sets different value
		await execute(client2Id, token2, setCacheCode('client2-data'));

		// Each should read their own value
		const result1 = await execute(client1Id, token1, getCacheCode);
		const result2 = await execute(client2Id, token2, getCacheCode);

		expect(result1.result).toBe('client1-data');
		expect(result2.result).toBe('client2-data');
	});

	test('should delete only client-specific cache entries', async () => {
		const { clientId: client1Id, token: token1 } = await initClient('delete1');
		const { clientId: client2Id, token: token2 } = await initClient('delete2');

		// Both set same key
		await execute(client1Id, token1, `await atp.cache.set('del-key', 'c1', 60)`);
		await execute(client2Id, token2, `await atp.cache.set('del-key', 'c2', 60)`);

		// Client 1 deletes
		await execute(client1Id, token1, `await atp.cache.delete('del-key')`);

		// Verify client 1's is deleted but client 2's remains
		const result1 = await execute(client1Id, token1, `return await atp.cache.get('del-key')`);
		const result2 = await execute(client2Id, token2, `return await atp.cache.get('del-key')`);

		expect(result1.result).toBeNull();
		expect(result2.result).toBe('c2');
	});
});
