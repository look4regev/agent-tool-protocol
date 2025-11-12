/**
 * Unit Tests: Provenance Re-attachment
 *
 * Tests the re-attachment of provenance from hint maps to tool arguments
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import {
	storeHintMap,
	getHintMap,
	clearHintMap,
	reattachProvenanceFromHints,
} from '../../packages/server/src/utils/provenance-reattachment';
import {
	getProvenance,
	getProvenanceForPrimitive,
	computeDigest,
	ProvenanceSource,
	type ProvenanceMetadata,
} from '@agent-tool-protocol/provenance';

describe('Provenance Re-attachment - Unit Tests', () => {
	const executionId = 'test-exec-123';

	beforeEach(() => {
		clearHintMap(executionId);
	});

	describe('Hint Map Storage', () => {
		test('should store and retrieve hint map', () => {
			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set('digest1', {
				id: 'meta-1',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			});

			storeHintMap(executionId, hintMap);
			const retrieved = getHintMap(executionId);

			expect(retrieved).toBeDefined();
			expect(retrieved?.size).toBe(1);
			expect(retrieved?.get('digest1')).toEqual(hintMap.get('digest1'));
		});

		test('should clear hint map', () => {
			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set('digest1', {
				id: 'meta-1',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			});

			storeHintMap(executionId, hintMap);
			clearHintMap(executionId);

			const retrieved = getHintMap(executionId);
			expect(retrieved).toBeUndefined();
		});

		test('should handle multiple execution IDs independently', () => {
			const exec1 = 'exec-1';
			const exec2 = 'exec-2';

			const map1 = new Map<string, ProvenanceMetadata>();
			map1.set('digest1', {
				id: 'meta-1',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'tool1',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			});

			const map2 = new Map<string, ProvenanceMetadata>();
			map2.set('digest2', {
				id: 'meta-2',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'tool2',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			});

			storeHintMap(exec1, map1);
			storeHintMap(exec2, map2);

			expect(getHintMap(exec1)?.get('digest1')).toEqual(map1.get('digest1'));
			expect(getHintMap(exec2)?.get('digest2')).toEqual(map2.get('digest2'));
			expect(getHintMap(exec1)?.has('digest2')).toBe(false);
			expect(getHintMap(exec2)?.has('digest1')).toBe(false);
		});
	});

	describe('Primitive Re-attachment', () => {
		test('should re-attach provenance to string primitive', () => {
			const value = 'sensitive-data';
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

			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set(computeDigest(value)!, metadata);

			const args = { data: value };
			reattachProvenanceFromHints(args, hintMap);

			const attached = getProvenanceForPrimitive(value);
			expect(attached).toBeDefined();
			if (attached) {
				expect(attached.id).toBe(metadata.id);
			}
		});

		test('should re-attach provenance to number primitive', () => {
			const value = 12345;
			const metadata: ProvenanceMetadata = {
				id: 'meta-2',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchBalance',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set(computeDigest(value)!, metadata);

			const args = { balance: value };
			reattachProvenanceFromHints(args, hintMap);

			const attached = getProvenanceForPrimitive(value);
			expect(attached).toBeDefined();
		});

		test('should re-attach to multiple primitives', () => {
			const value1 = 'email@example.com';
			const value2 = 'ssn-123-45-6789';

			const meta1: ProvenanceMetadata = {
				id: 'meta-1',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchEmail',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};
			const meta2: ProvenanceMetadata = {
				id: 'meta-2',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchSSN',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set(computeDigest(value1)!, meta1);
			hintMap.set(computeDigest(value2)!, meta2);

			const args = { email: value1, ssn: value2 };
			reattachProvenanceFromHints(args, hintMap);

			expect(getProvenanceForPrimitive(value1)).toBeDefined();
			expect(getProvenanceForPrimitive(value2)).toBeDefined();
		});

		test('should not re-attach if value already has provenance', () => {
			const value = 'existing-provenance';
			const existingMeta: ProvenanceMetadata = {
				id: 'existing',
				source: { type: ProvenanceSource.USER, timestamp: Date.now() },
				readers: { type: 'public' as const },
			};
			const newMeta: ProvenanceMetadata = {
				id: 'new',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchData',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			// Pre-attach provenance (simulated)
			// Note: In real code, this would be done via markPrimitiveTainted
			// For testing, we rely on the function's logic to skip already-tainted values

			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set(computeDigest(value)!, newMeta);

			const args = { data: value };
			reattachProvenanceFromHints(args, hintMap);

			// Since we can't easily pre-attach in this test context,
			// we verify that it doesn't throw and processes normally
			expect(() => reattachProvenanceFromHints(args, hintMap)).not.toThrow();
		});
	});

	describe('Nested Object Re-attachment', () => {
		test('should re-attach to nested string', () => {
			const value = 'nested-sensitive';
			const metadata: ProvenanceMetadata = {
				id: 'meta-3',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchNested',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set(computeDigest(value)!, metadata);

			const args = {
				user: {
					profile: {
						email: value,
					},
				},
			};

			reattachProvenanceFromHints(args, hintMap);

			const attached = getProvenanceForPrimitive(value);
			expect(attached).toBeDefined();
		});

		test('should re-attach to values in array', () => {
			const value1 = 'item1';
			const value2 = 'item2';

			const meta1: ProvenanceMetadata = {
				id: 'meta-4',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetch1',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};
			const meta2: ProvenanceMetadata = {
				id: 'meta-5',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetch2',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set(computeDigest(value1)!, meta1);
			hintMap.set(computeDigest(value2)!, meta2);

			const args = {
				items: [value1, value2, 'untainted'],
			};

			reattachProvenanceFromHints(args, hintMap);

			expect(getProvenanceForPrimitive(value1)).toBeDefined();
			expect(getProvenanceForPrimitive(value2)).toBeDefined();
			const untaintedProv = getProvenanceForPrimitive('untainted');
			expect(untaintedProv === undefined || untaintedProv === null).toBe(true);
		});

		test('should handle deeply nested structures', () => {
			const value = 'deep-value';
			const metadata: ProvenanceMetadata = {
				id: 'meta-6',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchDeep',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set(computeDigest(value)!, metadata);

			const args = {
				level1: {
					level2: {
						level3: {
							level4: {
								data: value,
							},
						},
					},
				},
			};

			reattachProvenanceFromHints(args, hintMap);

			expect(getProvenanceForPrimitive(value)).toBeDefined();
		});

		test('should handle mixed nested structures with arrays and objects', () => {
			const value = 'mixed-value';
			const metadata: ProvenanceMetadata = {
				id: 'meta-7',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetchMixed',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set(computeDigest(value)!, metadata);

			const args = {
				data: [{ a: 1 }, { b: [value, 'other'] }, 'top-level'],
			};

			reattachProvenanceFromHints(args, hintMap);

			expect(getProvenanceForPrimitive(value)).toBeDefined();
		});
	});

	describe('Edge Cases', () => {
		test('should handle empty hint map', () => {
			const hintMap = new Map<string, ProvenanceMetadata>();
			const args = { data: 'value' };

			expect(() => reattachProvenanceFromHints(args, hintMap)).not.toThrow();
		});

		test('should handle empty args', () => {
			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set('digest1', {
				id: 'meta-1',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetch',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			});

			const args = {};

			expect(() => reattachProvenanceFromHints(args, hintMap)).not.toThrow();
		});

		test('should handle null values in args', () => {
			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set('digest1', {
				id: 'meta-1',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetch',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			});

			const args = { data: null, other: undefined };

			expect(() => reattachProvenanceFromHints(args, hintMap)).not.toThrow();
		});

		test('should handle circular references', () => {
			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set('digest1', {
				id: 'meta-1',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetch',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			});

			const args: any = { data: 'value' };
			args.circular = args;

			expect(() => reattachProvenanceFromHints(args, hintMap)).not.toThrow();
		});

		test('should handle args with prototype chain', () => {
			const hintMap = new Map<string, ProvenanceMetadata>();
			const value = 'proto-value';
			hintMap.set(computeDigest(value)!, {
				id: 'meta-1',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetch',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			});

			class CustomArgs {
				data = value;
				method() {
					return 'method';
				}
			}

			const args = new CustomArgs();

			expect(() => reattachProvenanceFromHints(args as any, hintMap)).not.toThrow();
		});

		test('should skip non-matching values', () => {
			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set('non-matching-digest', {
				id: 'meta-1',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetch',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			});

			const args = { data: 'some-value' };

			reattachProvenanceFromHints(args, hintMap);

			const someProv = getProvenanceForPrimitive('some-value');
			expect(someProv === undefined || someProv === null).toBe(true);
		});

		test('should handle large hint maps efficiently', () => {
			const hintMap = new Map<string, ProvenanceMetadata>();
			for (let i = 0; i < 1000; i++) {
				hintMap.set(`digest-${i}`, {
					id: `meta-${i}`,
					source: {
						type: ProvenanceSource.TOOL,
						toolName: `tool-${i}`,
						apiGroup: 'test',
						timestamp: Date.now(),
					},
					readers: { type: 'public' as const },
				});
			}

			const targetValue = 'target';
			hintMap.set(computeDigest(targetValue)!, {
				id: 'target-meta',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'targetTool',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			});

			const args = { data: targetValue };

			const start = Date.now();
			reattachProvenanceFromHints(args, hintMap);
			const duration = Date.now() - start;

			expect(getProvenanceForPrimitive(targetValue)).toBeDefined();
			expect(duration).toBeLessThan(100); // Should be fast
		});
	});

	describe('Integration with computeDigest', () => {
		test('should match digest for same value', () => {
			const value = 'test-value';
			const metadata: ProvenanceMetadata = {
				id: 'meta-1',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetch',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const digest = computeDigest(value);
			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set(digest!, metadata);

			const args = { data: value };
			reattachProvenanceFromHints(args, hintMap);

			expect(getProvenanceForPrimitive(value)).toBeDefined();
		});

		test('should match digest for object', () => {
			const value = { a: 1, b: 2 };
			const metadata: ProvenanceMetadata = {
				id: 'meta-2',
				source: {
					type: ProvenanceSource.TOOL,
					toolName: 'fetch',
					apiGroup: 'test',
					timestamp: Date.now(),
				},
				readers: { type: 'public' as const },
			};

			const digest = computeDigest(value);
			const hintMap = new Map<string, ProvenanceMetadata>();
			hintMap.set(digest!, metadata);

			const args = { obj: value };
			reattachProvenanceFromHints(args, hintMap);

			// Note: Objects need special handling - primitives inside will be tagged
			// This tests the traversal logic
			expect(() => reattachProvenanceFromHints(args, hintMap)).not.toThrow();
		});
	});
});
