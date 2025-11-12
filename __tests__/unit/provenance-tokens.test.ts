/**
 * Unit Tests: Provenance Token System
 *
 * Tests token issuance, verification, and hint processing
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
	issueProvenanceToken,
	verifyProvenanceToken,
	verifyProvenanceHints,
	computeDigest,
	stableStringify,
	getClientSecret,
	ProvenanceSource,
	type TokenPayload,
	type ProvenanceMetadata,
} from '@agent-tool-protocol/provenance';
import { MemoryCache } from '@agent-tool-protocol/providers';

describe('Provenance Token System - Unit Tests', () => {
	let cache: MemoryCache;
	const clientId = 'test-client-123';
	const executionId = 'exec-456';

	beforeEach(() => {
		cache = new MemoryCache();
		process.env.PROVENANCE_SECRET = 'provenance-secret-32-bytes-minimum-length';
	});

	afterEach(async () => {
		delete process.env.PROVENANCE_SECRET;
		if (cache.disconnect) {
			await cache.disconnect();
		}
	});

	describe('Token Issuance', () => {
		test('should issue token for simple string', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-1',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'restricted' as const, readers: ['user@example.com'] },
			};

			const value = 'sensitive-data';
			const token = await issueProvenanceToken(
				metadata,
				value,
				clientId,
				executionId,
				cache,
				Date.now() + 3600000
			);

			expect(token).toBeDefined();
			expect(typeof token).toBe('string');
			expect(token!.split('.').length).toBe(2);
		});

		test('should issue token for object', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-2',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchUser',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'restricted' as const, readers: ['admin@example.com'] },
			};

			const value = { id: 123, email: 'user@example.com', ssn: '123-45-6789' };
			const token = await issueProvenanceToken(metadata, value, clientId, executionId, cache);

			expect(token).toBeDefined();
			expect(token).toContain('.');
		});

		test('should issue token for array', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-3',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'listEmails',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const value = ['email1@example.com', 'email2@example.com'];
			const token = await issueProvenanceToken(metadata, value, clientId, executionId, cache);

			expect(token).toBeDefined();
		});

		test('should store metadata in cache with correct key', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-4',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'getData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const token = await issueProvenanceToken(
				metadata,
				'test-value',
				clientId,
				executionId,
				cache
			);

			expect(token).toBeDefined();

			// Extract metaId from token payload
			const [body] = token!.split('.');
			const payload: TokenPayload = JSON.parse(Buffer.from(body!, 'base64url').toString());

			// Check that metadata was stored with the generated metaId
			const cacheKey = `prov:meta:${clientId}:${payload.metaId}`;
			const stored = await cache.get(cacheKey);
			expect(stored).toBeDefined();
			expect(JSON.parse(stored as string)).toEqual(metadata);
		});

		test('should use custom TTL', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-5',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'getData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const customTTL = 10; // 10 seconds
			const token = await issueProvenanceToken(
				metadata,
				'value',
				clientId,
				executionId,
				cache,
				customTTL
			);

			// Decode token and check that it was created
			expect(token).toBeDefined();
			const [body] = token!.split('.');
			const payload: TokenPayload = JSON.parse(Buffer.from(body!, 'base64url').toString());
			expect(payload.metaId).toBeDefined();
		});
	});

	describe('Token Verification', () => {
		test('should verify valid token', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-6',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'restricted' as const, readers: ['user@example.com'] },
			};

			const value = 'test-value';
			const token = (await issueProvenanceToken(
				metadata,
				value,
				clientId,
				executionId,
				cache
			)) as string;

			const verified = await verifyProvenanceToken(token, value, clientId, executionId, cache);

			expect(verified).toEqual(metadata);
		});

		test('should reject token with wrong signature', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-7',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const value = 'test-value';
			const token = await issueProvenanceToken(metadata, value, clientId, executionId, cache);

			// Tamper with signature
			const [body] = token!.split('.');
			const tamperedToken = `${body}.invalid-signature`;

			const verified = await verifyProvenanceToken(
				tamperedToken,
				value,
				clientId,
				executionId,
				cache
			);

			expect(verified).toBeNull();
		});

		test('should reject token with wrong clientId', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-8',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const value = 'test-value';
			const token = (await issueProvenanceToken(
				metadata,
				value,
				clientId,
				executionId,
				cache
			)) as string;

			const verified = await verifyProvenanceToken(
				token,
				value,
				'wrong-client-id',
				executionId,
				cache
			);

			expect(verified).toBeNull();
		});

		test('should reject token with wrong executionId', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-9',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const value = 'test-value';
			const token = await issueProvenanceToken(metadata, value, clientId, executionId, cache);

			const verified = await verifyProvenanceToken(
				token!,
				value,
				clientId,
				'wrong-execution-id',
				cache
			);

			expect(verified).toBeNull();
		});

		test('should reject token with modified value', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-10',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const value = 'original-value';
			const token = await issueProvenanceToken(metadata, value, clientId, executionId, cache);

			const verified = await verifyProvenanceToken(
				token!,
				'modified-value',
				clientId,
				executionId,
				cache
			);

			expect(verified).toBeNull();
		});

		test('should reject expired token', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-11',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const value = 'test-value';
			const expiredTTL = -1; // Negative TTL (expired)
			const token = await issueProvenanceToken(
				metadata,
				value,
				clientId,
				executionId,
				cache,
				expiredTTL
			);

			// Token should still be created
			expect(token).toBeDefined();

			// But verification should fail because metadata expired from cache
			// Wait a moment to ensure it's expired
			await new Promise((resolve) => setTimeout(resolve, 100));

			const verified = await verifyProvenanceToken(token!, value, clientId, executionId, cache);

			expect(verified).toBeNull();
		});

		test('should reject token when metadata missing from cache', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-12',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const value = 'test-value';
			const token = await issueProvenanceToken(metadata, value, clientId, executionId, cache);

			expect(token).toBeDefined();

			// Extract metaId and delete metadata from cache
			const [body] = token!.split('.');
			const payload: TokenPayload = JSON.parse(Buffer.from(body!, 'base64url').toString());
			const cacheKey = `prov:meta:${clientId}:${payload.metaId}`;
			await cache.delete(cacheKey);

			const verified = await verifyProvenanceToken(token!, value, clientId, executionId, cache);

			expect(verified).toBeNull();
		});
	});

	describe('Hint Verification', () => {
		test('should verify multiple hints', async () => {
			const meta1: ProvenanceMetadata = {
				id: 'meta-h1',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'tool1',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};
			const meta2: ProvenanceMetadata = {
				id: 'meta-h2',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'tool2',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const value1 = 'value1';
			const value2 = 'value2';

			const token1 = await issueProvenanceToken(meta1, value1, clientId, executionId, cache);
			const token2 = await issueProvenanceToken(meta2, value2, clientId, executionId, cache);

			const hintMap = await verifyProvenanceHints([token1!, token2!], clientId, executionId, cache);

			expect(hintMap.size).toBe(2);
			expect(hintMap.get(computeDigest(value1)!)).toEqual(meta1);
			expect(hintMap.get(computeDigest(value2)!)).toEqual(meta2);
		});

		test('should skip invalid hints silently', async () => {
			const meta1: ProvenanceMetadata = {
				id: 'meta-h3',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'tool1',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const value1 = 'value1';
			const token1 = await issueProvenanceToken(meta1, value1, clientId, executionId, cache);

			const hintMap = await verifyProvenanceHints(
				[token1!, 'invalid-token', 'another-bad-token'],
				clientId,
				executionId,
				cache
			);

			expect(hintMap.size).toBe(1);
			expect(hintMap.get(computeDigest(value1)!)).toEqual(meta1);
		});

		test('should cap hints at maxHints limit', async () => {
			const hints: string[] = [];
			for (let i = 0; i < 50; i++) {
				const meta: ProvenanceMetadata = {
					id: `meta-h${i}`,
					source: {
						type: ProvenanceSource.TOOL,
						toolName: `tool${i}`,
						apiGroup: 'test',
						timestamp: Date.now(),
					},
					readers: { type: 'public' as const },
				};
				const token = await issueProvenanceToken(meta, `value${i}`, clientId, executionId, cache);
				hints.push(token!);
			}

			const hintMap = await verifyProvenanceHints(
				hints,
				clientId,
				executionId,
				cache,
				20 // maxHints
			);

			expect(hintMap.size).toBeLessThanOrEqual(20);
		});

		test('should filter expired hints', async () => {
			const meta1: ProvenanceMetadata = {
				id: 'meta-h5',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'tool1',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};
			const meta2: ProvenanceMetadata = {
				id: 'meta-h6',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'tool2',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const value1 = 'value1';
			const value2 = 'value2';

			const token1 = await issueProvenanceToken(
				meta1,
				value1,
				clientId,
				executionId,
				cache,
				-1 // Expired immediately
			);
			const token2 = await issueProvenanceToken(
				meta2,
				value2,
				clientId,
				executionId,
				cache,
				3600 // Valid for 1 hour
			);

			// Wait for token1 to expire
			await new Promise((resolve) => setTimeout(resolve, 100));

			const hintMap = await verifyProvenanceHints([token1!, token2!], clientId, executionId, cache);

			expect(hintMap.size).toBe(1);
			expect(hintMap.get(computeDigest(value2)!)).toEqual(meta2);
		});

		test('should handle hints with missing cache metadata', async () => {
			const meta1: ProvenanceMetadata = {
				id: 'meta-h7',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'tool1',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const value1 = 'value1';
			const token1 = await issueProvenanceToken(meta1, value1, clientId, executionId, cache);

			expect(token1).toBeDefined();

			// Extract metaId and delete from cache
			const [body] = token1!.split('.');
			const payload: TokenPayload = JSON.parse(Buffer.from(body!, 'base64url').toString());
			await cache.delete(`prov:meta:${clientId}:${payload.metaId}`);

			const hintMap = await verifyProvenanceHints([token1!], clientId, executionId, cache);

			expect(hintMap.size).toBe(0);
		});
	});

	describe('Digest Computation', () => {
		test('should compute same digest for same value', () => {
			const value = { a: 1, b: 2, c: 3 };
			const digest1 = computeDigest(value);
			const digest2 = computeDigest(value);
			expect(digest1).toBe(digest2);
		});

		test('should compute same digest for objects with different key order', () => {
			const value1 = { a: 1, b: 2, c: 3 };
			const value2 = { c: 3, a: 1, b: 2 };
			const digest1 = computeDigest(value1);
			const digest2 = computeDigest(value2);
			expect(digest1).toBe(digest2);
		});

		test('should compute different digests for different values', () => {
			const digest1 = computeDigest('value1');
			const digest2 = computeDigest('value2');
			expect(digest1).not.toBe(digest2);
		});

		test('should handle nested objects', () => {
			const value = { user: { id: 1, profile: { name: 'Alice' } } };
			const digest = computeDigest(value);
			expect(digest).toBeDefined();
			expect(typeof digest).toBe('string');
		});

		test('should handle arrays', () => {
			const value = [1, 2, 3, { a: 'b' }];
			const digest = computeDigest(value);
			expect(digest).toBeDefined();
		});

		test('should handle primitives', () => {
			expect(computeDigest('string')).toBeDefined();
			expect(computeDigest(123)).toBeDefined();
			expect(computeDigest(true)).toBeDefined();
			expect(computeDigest(null)).toBeDefined();
		});
	});

	describe('Stable Stringify', () => {
		test('should produce consistent output for same object', () => {
			const obj = { a: 1, b: 2 };
			const str1 = stableStringify(obj);
			const str2 = stableStringify(obj);
			expect(str1).toBe(str2);
		});

		test('should sort object keys', () => {
			const obj1 = { z: 1, a: 2, m: 3 };
			const obj2 = { a: 2, m: 3, z: 1 };
			expect(stableStringify(obj1)).toBe(stableStringify(obj2));
		});

		test('should handle nested objects', () => {
			const obj = { outer: { z: 1, a: 2 }, top: 'value' };
			const str = stableStringify(obj);
			expect(str).toBe('{"outer":{"a":2,"z":1},"top":"value"}');
		});

		test('should preserve arrays', () => {
			const obj = { arr: [3, 1, 2] };
			const str = stableStringify(obj);
			expect(str).toBe('{"arr":[3,1,2]}');
		});
	});

	describe('Client Secret Management', () => {
		test('should return consistent secret for same client', () => {
			const secret1 = getClientSecret('client-1');
			const secret2 = getClientSecret('client-1');
			expect(secret1).toBe(secret2);
		});

		test('should return a non-empty secret', () => {
			const secret = getClientSecret('test-client');
			expect(secret).toBeDefined();
			expect(secret.length).toBeGreaterThan(0);
		});
	});

	describe('Edge Cases', () => {
		test('should handle empty string value', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-edge1',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'getData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const token = await issueProvenanceToken(metadata, '', clientId, executionId, cache);
			const verified = await verifyProvenanceToken(token!, '', clientId, executionId, cache);
			expect(verified).toEqual(metadata);
		});

		test('should handle null value', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-edge2',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'getData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const token = await issueProvenanceToken(metadata, null, clientId, executionId, cache);
			const verified = await verifyProvenanceToken(token!, null, clientId, executionId, cache);
			expect(verified).toEqual(metadata);
		});

		test('should handle very large object', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-edge3',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'getData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const largeObj: any = {};
			for (let i = 0; i < 1000; i++) {
				largeObj[`key${i}`] = `value${i}`;
			}

			const token = await issueProvenanceToken(metadata, largeObj, clientId, executionId, cache);
			const verified = await verifyProvenanceToken(token!, largeObj, clientId, executionId, cache);
			expect(verified).toEqual(metadata);
		});

		test('should handle special characters in strings', async () => {
			const metadata: ProvenanceMetadata = {
				id: 'meta-edge4',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'getData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const value = 'Test with special chars: 你好 émojis 🎉 and\nnewlines\ttabs';
			const token = await issueProvenanceToken(metadata, value, clientId, executionId, cache);
			const verified = await verifyProvenanceToken(token!, value, clientId, executionId, cache);
			expect(verified).toEqual(metadata);
		});

		test('should handle circular reference gracefully', () => {
			const obj: any = { a: 1 };
			obj.self = obj;

			// Should not throw
			expect(() => computeDigest(obj)).not.toThrow();
		});
	});
});
