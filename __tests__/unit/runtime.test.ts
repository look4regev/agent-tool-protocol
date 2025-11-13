import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import {
	approval,
	cache,
	initializeCache,
	initializeApproval,
	setCurrentExecutionId,
	clearCurrentExecutionId,
} from '@mondaydotcomorg/atp-runtime';

describe('Runtime - Approval System', () => {
	beforeEach(() => {
		// Set execution context for unit tests
		setCurrentExecutionId('unit-test-execution');
	});

	test('should handle approval requests', async () => {
		initializeApproval(async (request) => {
			expect(request.message).toBe('Test approval');
			expect(request.context).toEqual({ test: true });
			return {
				approved: true,
				timestamp: Date.now(),
			};
		});

		const result = await approval.request('Test approval', { test: true });
		expect(result.approved).toBe(true);
		expect(result.timestamp).toBeDefined();
	});

	test('should handle approval requests with context', async () => {
		initializeApproval(async (request) => {
			expect(request.message).toBe('Delete records?');
			expect(request.context).toEqual({ count: 10 });
			return {
				approved: false,
				timestamp: Date.now(),
			};
		});

		const result = await approval.request('Delete records?', { count: 10 });
		expect(result.approved).toBe(false);
	});
});

describe('Runtime - Cache System', () => {
	beforeAll(() => {
		initializeCache({
			type: 'memory',
			maxKeys: 100,
			defaultTTL: 60,
		});
	});

	test('should set and get cache values', async () => {
		const key = 'test-key-1';
		const value = { data: 'test', timestamp: Date.now() };

		await cache.set(key, value, 60);
		const retrieved = await cache.get(key);

		expect(retrieved).toEqual(value);
	});

	test('should return null for non-existent keys', async () => {
		const result = await cache.get('non-existent-key');
		expect(result).toBeNull();
	});

	test('should check if key exists', async () => {
		const key = 'test-key-2';
		await cache.set(key, 'value', 60);

		const exists = await cache.has(key);
		expect(exists).toBe(true);

		const notExists = await cache.has('non-existent');
		expect(notExists).toBe(false);
	});

	test('should delete cache entries', async () => {
		const key = 'test-key-3';
		await cache.set(key, 'value', 60);

		let exists = await cache.has(key);
		expect(exists).toBe(true);

		await cache.delete(key);

		exists = await cache.has(key);
		expect(exists).toBe(false);
	});

	test('should handle TTL expiration', async () => {
		const key = 'test-key-ttl';
		await cache.set(key, 'value', 1); // 1 second TTL

		let value = await cache.get(key);
		expect(value).toBe('value');

		// Wait for expiration
		await new Promise((resolve) => setTimeout(resolve, 1500));

		value = await cache.get(key);
		expect(value).toBeNull();
	}, 5000);
});
