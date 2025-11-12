/**
 * Unit Tests: Client-Side Provenance Token Registry
 *
 * Tests the LRU cache for storing and managing provenance tokens on the client
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import { ProvenanceTokenRegistry } from '../../packages/client/src/core/provenance-registry';

// Helper to create a mock token with specific expiry
// Use a counter to ensure unique tokens
let tokenCounter = 0;
function createMockToken(expiresAt: number): string {
	tokenCounter++;
	const payload = {
		v: 1,
		clientId: 'test-client',
		executionId: 'test-exec',
		expiresAt,
		valueDigest: `mock-digest-${tokenCounter}`,
		metaId: `mock-meta-${tokenCounter}`,
	};
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${body}.mock-signature-${tokenCounter}`;
}

describe('ProvenanceTokenRegistry - Unit Tests', () => {
	let registry: ProvenanceTokenRegistry;

	beforeEach(() => {
		tokenCounter = 0; // Reset counter for each test
		registry = new ProvenanceTokenRegistry(100, 1); // 100 tokens, 1 hour TTL
	});

	describe('Basic Operations', () => {
		test('should add token to registry', () => {
			const token = createMockToken(Date.now() + 3600000);
			registry.add(token);
			expect(registry.size()).toBe(1);
		});

		test('should retrieve recent tokens', () => {
			const token1 = createMockToken(Date.now() + 3600000);
			const token2 = createMockToken(Date.now() + 3600000);

			registry.add(token1);
			registry.add(token2);

			const recent = registry.getRecentTokens(10);
			expect(recent).toHaveLength(2);
			expect(recent).toContain(token1);
			expect(recent).toContain(token2);
		});

		test('should clear all tokens', () => {
			const token1 = createMockToken(Date.now() + 3600000);
			const token2 = createMockToken(Date.now() + 3600000);

			registry.add(token1);
			registry.add(token2);
			expect(registry.size()).toBe(2);

			registry.clear();
			expect(registry.size()).toBe(0);
		});

		test('should return current size', () => {
			expect(registry.size()).toBe(0);

			registry.add(createMockToken(Date.now() + 3600000));
			expect(registry.size()).toBe(1);

			registry.add(createMockToken(Date.now() + 3600000));
			expect(registry.size()).toBe(2);
		});
	});

	describe('LRU Eviction', () => {
		test('should evict oldest token when max size exceeded', () => {
			const smallRegistry = new ProvenanceTokenRegistry(3, 1);

			const token1 = createMockToken(Date.now() + 3600000);
			const token2 = createMockToken(Date.now() + 3600000);
			const token3 = createMockToken(Date.now() + 3600000);
			const token4 = createMockToken(Date.now() + 3600000);

			smallRegistry.add(token1);
			smallRegistry.add(token2);
			smallRegistry.add(token3);
			smallRegistry.add(token4); // Should evict token1

			const recent = smallRegistry.getRecentTokens(10);
			expect(recent).toHaveLength(3);
			expect(recent).not.toContain(token1);
			expect(recent).toContain(token2);
			expect(recent).toContain(token3);
			expect(recent).toContain(token4);
		});

		test('should keep most recently added tokens', () => {
			const smallRegistry = new ProvenanceTokenRegistry(5, 1);

			const tokens: string[] = [];
			for (let i = 0; i < 10; i++) {
				const token = createMockToken(Date.now() + 3600000);
				tokens.push(token);
				smallRegistry.add(token);
			}

			const recent = smallRegistry.getRecentTokens(10);
			expect(recent).toHaveLength(5);

			// Should contain the last 5 tokens
			for (let i = 5; i < 10; i++) {
				expect(recent).toContain(tokens[i]);
			}
		});

		test('should move existing token to end when re-added', () => {
			const smallRegistry = new ProvenanceTokenRegistry(3, 1);

			const token1 = createMockToken(Date.now() + 3600000);
			const token2 = createMockToken(Date.now() + 3600000);
			const token3 = createMockToken(Date.now() + 3600000);

			smallRegistry.add(token1);
			smallRegistry.add(token2);
			smallRegistry.add(token3);

			// Re-add token1 (should move to end)
			smallRegistry.add(token1);

			expect(smallRegistry.size()).toBe(3);

			const token4 = createMockToken(Date.now() + 3600000);
			smallRegistry.add(token4); // Should evict token2 (not token1)

			const recent = smallRegistry.getRecentTokens(10);
			expect(recent).toContain(token1);
			expect(recent).not.toContain(token2);
			expect(recent).toContain(token3);
			expect(recent).toContain(token4);
		});
	});

	describe('Token Expiration', () => {
		test('should filter out expired tokens when retrieving', () => {
			const validToken = createMockToken(Date.now() + 3600000); // Valid for 1 hour
			const expiredToken = createMockToken(Date.now() - 1000); // Expired 1 second ago

			registry.add(validToken);
			registry.add(expiredToken);

			const recent = registry.getRecentTokens(10);
			expect(recent).toHaveLength(1);
			expect(recent).toContain(validToken);
			expect(recent).not.toContain(expiredToken);
		});

		test('should remove expired tokens from internal storage', () => {
			const validToken = createMockToken(Date.now() + 3600000);
			const expiredToken1 = createMockToken(Date.now() - 1000);
			const expiredToken2 = createMockToken(Date.now() - 2000);

			registry.add(validToken);
			registry.add(expiredToken1);
			registry.add(expiredToken2);

			expect(registry.size()).toBe(3);

			// Calling getRecentTokens should clean up expired tokens
			registry.getRecentTokens(10);

			expect(registry.size()).toBe(1);
		});

		test('should handle all expired tokens', () => {
			const expiredToken1 = createMockToken(Date.now() - 1000);
			const expiredToken2 = createMockToken(Date.now() - 2000);

			registry.add(expiredToken1);
			registry.add(expiredToken2);

			const recent = registry.getRecentTokens(10);
			expect(recent).toHaveLength(0);
			expect(registry.size()).toBe(0);
		});

		test('should handle malformed tokens during expiration check', () => {
			const validToken = createMockToken(Date.now() + 3600000);
			const malformedToken = 'not-a-valid-token';

			registry.add(validToken);
			registry.add(malformedToken);

			const recent = registry.getRecentTokens(10);
			expect(recent).toHaveLength(1);
			expect(recent).toContain(validToken);
		});
	});

	describe('Recent Token Retrieval', () => {
		test('should respect count limit', () => {
			for (let i = 0; i < 20; i++) {
				registry.add(createMockToken(Date.now() + 3600000));
			}

			const recent = registry.getRecentTokens(5);
			expect(recent).toHaveLength(5);
		});

		test('should return tokens in most recent order', () => {
			const tokens: string[] = [];
			for (let i = 0; i < 10; i++) {
				const token = createMockToken(Date.now() + 3600000);
				tokens.push(token);
				registry.add(token);
			}

			const recent = registry.getRecentTokens(10);

			// Most recent should be at the end
			expect(recent[recent.length - 1]).toBe(tokens[tokens.length - 1]);
		});

		test('should return all tokens if count exceeds size', () => {
			registry.add(createMockToken(Date.now() + 3600000));
			registry.add(createMockToken(Date.now() + 3600000));

			const recent = registry.getRecentTokens(100);
			expect(recent).toHaveLength(2);
		});

		test('should return empty array if no tokens', () => {
			const recent = registry.getRecentTokens(10);
			expect(recent).toHaveLength(0);
		});

		test('should handle count of zero', () => {
			registry.add(createMockToken(Date.now() + 3600000));
			const recent = registry.getRecentTokens(0);
			expect(recent).toHaveLength(0);
		});
	});

	describe('Duplicate Handling', () => {
		test('should not duplicate tokens', () => {
			const token = createMockToken(Date.now() + 3600000);

			registry.add(token);
			registry.add(token);
			registry.add(token);

			expect(registry.size()).toBe(1);
		});

		test('should move duplicate to most recent position', () => {
			const smallRegistry = new ProvenanceTokenRegistry(3, 1);

			const token1 = createMockToken(Date.now() + 3600000);
			const token2 = createMockToken(Date.now() + 3600000);
			const token3 = createMockToken(Date.now() + 3600000);

			smallRegistry.add(token1);
			smallRegistry.add(token2);
			smallRegistry.add(token3);

			// Re-add token1
			smallRegistry.add(token1);

			const recent = smallRegistry.getRecentTokens(10);
			// token1 should be last (most recent)
			expect(recent[recent.length - 1]).toBe(token1);
		});
	});

	describe('Large Scale Operations', () => {
		test('should handle large number of tokens', () => {
			const largeRegistry = new ProvenanceTokenRegistry(10000, 1);

			const tokens: string[] = [];
			for (let i = 0; i < 1000; i++) {
				const token = createMockToken(Date.now() + 3600000);
				tokens.push(token);
				largeRegistry.add(token);
			}

			// Size should match (tokens are unique due to counter)
			expect(largeRegistry.size()).toBe(1000);

			const recent = largeRegistry.getRecentTokens(100);
			// All tokens are valid, so we should get exactly 100
			expect(recent).toHaveLength(100);

			// Size should still be 1000 after retrieval (no expired tokens to remove)
			expect(largeRegistry.size()).toBe(1000);
		});

		test('should efficiently evict when adding many tokens beyond capacity', () => {
			const registry = new ProvenanceTokenRegistry(100, 1);

			const start = Date.now();
			for (let i = 0; i < 1000; i++) {
				registry.add(createMockToken(Date.now() + 3600000));
			}
			const duration = Date.now() - start;

			expect(registry.size()).toBe(100);
			expect(duration).toBeLessThan(100); // Should be fast
		});

		test('should handle rapid addition and retrieval', () => {
			const registry = new ProvenanceTokenRegistry(1000, 1);

			for (let iteration = 0; iteration < 10; iteration++) {
				for (let i = 0; i < 100; i++) {
					registry.add(createMockToken(Date.now() + 3600000));
				}
				const recent = registry.getRecentTokens(50);
				expect(recent.length).toBeGreaterThan(0);
			}

			expect(registry.size()).toBeLessThanOrEqual(1000);
		});
	});

	describe('TTL Configuration', () => {
		test('should respect custom TTL in hours', () => {
			const shortTTLRegistry = new ProvenanceTokenRegistry(100, 0.001); // ~3.6 seconds

			const futureToken = createMockToken(Date.now() + 3600000); // 1 hour from now
			const nearExpiredToken = createMockToken(Date.now() + 2000); // 2 seconds from now

			shortTTLRegistry.add(futureToken);
			shortTTLRegistry.add(nearExpiredToken);

			// Both should be present initially
			let recent = shortTTLRegistry.getRecentTokens(10);
			expect(recent).toHaveLength(2);
		});

		test('should use configured TTL for filtering', () => {
			const registry = new ProvenanceTokenRegistry(100, 1); // 1 hour TTL

			const validToken = createMockToken(Date.now() + 7200000); // 2 hours from now
			const almostExpiredToken = createMockToken(Date.now() + 1800000); // 30 min from now
			const expiredToken = createMockToken(Date.now() - 1000); // Expired

			registry.add(validToken);
			registry.add(almostExpiredToken);
			registry.add(expiredToken);

			const recent = registry.getRecentTokens(10);
			expect(recent).toHaveLength(2); // Only non-expired
		});
	});

	describe('Edge Cases', () => {
		test('should handle maxSize of 1', () => {
			const tinyRegistry = new ProvenanceTokenRegistry(1, 1);

			const token1 = createMockToken(Date.now() + 3600000);
			const token2 = createMockToken(Date.now() + 3600000);

			tinyRegistry.add(token1);
			tinyRegistry.add(token2);

			expect(tinyRegistry.size()).toBe(1);
			expect(tinyRegistry.getRecentTokens(10)).toContain(token2);
		});

		test('should handle empty token string', () => {
			expect(() => registry.add('')).not.toThrow();
		});

		test('should handle invalid token format gracefully', () => {
			registry.add('invalid-token');
			registry.add('another.invalid.token.format');

			// Should filter these out when retrieving
			const recent = registry.getRecentTokens(10);
			expect(recent).toHaveLength(0);
		});

		test('should handle token with invalid base64', () => {
			const invalidToken = 'not-valid-base64!!.signature';
			registry.add(invalidToken);

			const recent = registry.getRecentTokens(10);
			expect(recent).toHaveLength(0);
		});

		test('should handle token with invalid JSON payload', () => {
			const invalidJSON = Buffer.from('not-json').toString('base64url');
			const token = `${invalidJSON}.signature`;
			registry.add(token);

			const recent = registry.getRecentTokens(10);
			expect(recent).toHaveLength(0);
		});

		test('should handle tokens missing expiresAt field', () => {
			const payload = { v: 1, clientId: 'test' }; // Missing expiresAt
			const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
			const token = `${body}.signature`;

			registry.add(token);

			// Should handle gracefully and filter out
			expect(() => registry.getRecentTokens(10)).not.toThrow();
		});

		test('should maintain consistency across operations', () => {
			const tokens: string[] = [];
			for (let i = 0; i < 10; i++) {
				const token = createMockToken(Date.now() + 3600000);
				tokens.push(token);
				registry.add(token);
			}

			expect(registry.size()).toBe(10);

			const recent1 = registry.getRecentTokens(5);
			const recent2 = registry.getRecentTokens(5);

			expect(recent1).toEqual(recent2);
		});
	});

	describe('Concurrent-like Operations', () => {
		test('should handle rapid additions', () => {
			const tokens = Array.from({ length: 100 }, () => createMockToken(Date.now() + 3600000));

			tokens.forEach((token) => registry.add(token));

			expect(registry.size()).toBe(100);
		});

		test('should handle interleaved add and retrieve', () => {
			for (let i = 0; i < 50; i++) {
				registry.add(createMockToken(Date.now() + 3600000));
				if (i % 10 === 0) {
					const recent = registry.getRecentTokens(5);
					expect(recent.length).toBeGreaterThan(0);
				}
			}

			expect(registry.size()).toBeLessThanOrEqual(100);
		});

		test('should handle add, clear, add pattern', () => {
			registry.add(createMockToken(Date.now() + 3600000));
			expect(registry.size()).toBe(1);

			registry.clear();
			expect(registry.size()).toBe(0);

			registry.add(createMockToken(Date.now() + 3600000));
			expect(registry.size()).toBe(1);
		});
	});
});
