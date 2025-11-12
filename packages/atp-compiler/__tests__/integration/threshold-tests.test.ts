/**
 * SMART BATCHING THRESHOLD TESTS
 *
 * Tests the configurable batchSizeThreshold feature to ensure:
 * 1. Simple callbacks always batch (no conditionals)
 * 2. Conditional callbacks respect array size threshold
 * 3. Unknown-size arrays with conditionals use sequential
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { ATPCompiler } from '../../src/transformer/index';

describe('Smart Batching Threshold Tests', () => {
	describe('Simple Callbacks (No Conditionals) - ALWAYS Batch', () => {
		test('Small array + simple callback - BATCH', () => {
			const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });
			const code = `
        const results = await [1, 2, 3].map(async (x) => {
          return await atp.llm.call({ prompt: String(x) });
        });
      `;
			const result = compiler.transform(code);

			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).not.toContain('resumableMap');
		});

		test('Large array + simple callback - BATCH', () => {
			const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });
			const code = `
        const results = await [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(async (x) => {
          return await atp.llm.call({ prompt: String(x) });
        });
      `;
			const result = compiler.transform(code);

			// Simple callback always batches regardless of size
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).not.toContain('resumableMap');
		});

		test('Unknown size + simple callback - BATCH', () => {
			const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });
			const code = `
        const results = await items.map(async (x) => {
          return await atp.llm.call({ prompt: String(x) });
        });
      `;
			const result = compiler.transform(code);

			// Simple callback always batches even with unknown size
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).not.toContain('resumableMap');
		});
	});

	describe('Conditional Callbacks - Size-Based Decisions', () => {
		describe('Small Arrays (< threshold)', () => {
			test('Size 3 < threshold 10 - BATCH', () => {
				const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });
				const code = `
          const found = await [1, 2, 3].find(async (x) => {
            if (x > 1) {
              return await atp.llm.call({ prompt: String(x) });
            }
            return false;
          });
        `;
				const result = compiler.transform(code);

				expect(result.transformed).toBe(true);
				expect(result.code).toContain('batchParallel');
				expect(result.code).not.toContain('resumableFind');
			});

			test('Size 5 < threshold 10 - BATCH', () => {
				const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });
				const code = `
          const results = await [1,2,3,4,5].filter(async (x) => {
            if (x % 2 === 0) {
              return await atp.llm.call({ prompt: String(x) });
            }
            return false;
          });
        `;
				const result = compiler.transform(code);

				expect(result.transformed).toBe(true);
				expect(result.code).toContain('batchParallel');
				expect(result.code).not.toContain('resumableFilter');
			});

			test('Size 9 < threshold 10 - BATCH', () => {
				const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });
				const code = `
          const hasAny = await [1,2,3,4,5,6,7,8,9].some(async (x) => {
            if (x > 5) {
              return await atp.llm.call({ prompt: String(x) });
            }
            return false;
          });
        `;
				const result = compiler.transform(code);

				expect(result.transformed).toBe(true);
				expect(result.code).toContain('batchParallel');
				expect(result.code).not.toContain('resumableSome');
			});
		});

		describe('Large Arrays (>= threshold)', () => {
			test('Size 10 >= threshold 10 - SEQUENTIAL', () => {
				const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });
				const code = `
          const found = await [1,2,3,4,5,6,7,8,9,10].find(async (x) => {
            if (x > 5) {
              return await atp.llm.call({ prompt: String(x) });
            }
            return false;
          });
        `;
				const result = compiler.transform(code);

				expect(result.transformed).toBe(true);
				expect(result.code).toContain('resumableFind');
				expect(result.code).not.toContain('batchParallel');
			});

			test('Size 15 >= threshold 10 - SEQUENTIAL', () => {
				const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });
				const code = `
          const results = await [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].filter(async (x) => {
            if (x % 2 === 0) {
              return await atp.llm.call({ prompt: String(x) });
            }
            return false;
          });
        `;
				const result = compiler.transform(code);

				expect(result.transformed).toBe(true);
				expect(result.code).toContain('resumableFilter');
				expect(result.code).not.toContain('batchParallel');
			});

			test('Size 20 >= threshold 10 - SEQUENTIAL', () => {
				const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });
				const array = Array.from({ length: 20 }, (_, i) => i + 1).join(',');
				const code = `
          const allValid = await [${array}].every(async (x) => {
            if (x < 15) {
              return await atp.llm.call({ prompt: String(x) });
            }
            return false;
          });
        `;
				const result = compiler.transform(code);

				expect(result.transformed).toBe(true);
				expect(result.code).toContain('resumableEvery');
				expect(result.code).not.toContain('batchParallel');
			});
		});

		describe('Unknown Size Arrays', () => {
			test('Variable array + conditional - SEQUENTIAL (conservative)', () => {
				const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });
				const code = `
          const found = await items.find(async (x) => {
            if (x > 5) {
              return await atp.llm.call({ prompt: String(x) });
            }
            return false;
          });
        `;
				const result = compiler.transform(code);

				// Unknown size + conditional → sequential for safety
				expect(result.transformed).toBe(true);
				expect(result.code).toContain('resumableFind');
				expect(result.code).not.toContain('batchParallel');
			});

			test('Variable array filter + conditional - SEQUENTIAL', () => {
				const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });
				const code = `
          const results = await items.filter(async (item) => {
            if (item.priority > 5) {
              return await atp.llm.call({ prompt: item.name });
            }
            return false;
          });
        `;
				const result = compiler.transform(code);

				expect(result.transformed).toBe(true);
				expect(result.code).toContain('resumableFilter');
				expect(result.code).not.toContain('batchParallel');
			});
		});
	});

	describe('Different Threshold Values', () => {
		test('Conservative threshold (5) - More sequential', () => {
			const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 5 });

			// 7 items > threshold 5
			const code = `
        const found = await [1,2,3,4,5,6,7].find(async (x) => {
          if (x > 3) {
            return await atp.llm.call({ prompt: String(x) });
          }
          return false;
        });
      `;
			const result = compiler.transform(code);

			expect(result.transformed).toBe(true);
			expect(result.code).toContain('resumableFind');
			expect(result.code).not.toContain('batchParallel');
		});

		test('Aggressive threshold (20) - More batching', () => {
			const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 20 });

			// 15 items < threshold 20
			const code = `
        const found = await [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].find(async (x) => {
          if (x > 10) {
            return await atp.llm.call({ prompt: String(x) });
          }
          return false;
        });
      `;
			const result = compiler.transform(code);

			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).not.toContain('resumableFind');
		});

		test('Very aggressive threshold (50) - Almost always batch', () => {
			const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 50 });

			// 30 items < threshold 50
			const array = Array.from({ length: 30 }, (_, i) => i + 1).join(',');
			const code = `
        const results = await [${array}].filter(async (x) => {
          if (x % 2 === 0) {
            return await atp.llm.call({ prompt: String(x) });
          }
          return false;
        });
      `;
			const result = compiler.transform(code);

			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).not.toContain('resumableFilter');
		});

		test('Threshold at exact boundary', () => {
			const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });

			// Exactly 10 items = threshold
			const code = `
        const found = await [1,2,3,4,5,6,7,8,9,10].find(async (x) => {
          if (x > 5) {
            return await atp.llm.call({ prompt: String(x) });
          }
          return false;
        });
      `;
			const result = compiler.transform(code);

			// >= threshold → sequential
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('resumableFind');
			expect(result.code).not.toContain('batchParallel');
		});
	});

	describe('All Array Methods', () => {
		const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });

		test('map() - respects threshold', () => {
			const code = `
        const results = await [1,2,3,4,5,6,7,8,9,10,11,12].map(async (x) => {
          if (x > 5) {
            return await atp.llm.call({ prompt: String(x) });
          }
          return x;
        });
      `;
			const result = compiler.transform(code);

			// 12 >= 10 + conditional → sequential
			expect(result.code).toContain('resumableMap');
		});

		test('forEach() - respects threshold', () => {
			const code = `
        await [1,2,3,4,5,6,7,8,9,10,11,12].forEach(async (x) => {
          if (x > 5) {
            await atp.llm.call({ prompt: String(x) });
          }
        });
      `;
			const result = compiler.transform(code);

			// 12 >= 10 + conditional → sequential
			expect(result.code).toContain('resumableForEach');
		});

		test('filter() - respects threshold', () => {
			const code = `
        const valid = await [1,2,3].filter(async (x) => {
          if (x > 1) {
            return await atp.llm.call({ prompt: String(x) });
          }
          return false;
        });
      `;
			const result = compiler.transform(code);

			// 3 < 10 + conditional → batch
			expect(result.code).toContain('batchParallel');
		});

		test('find() - respects threshold', () => {
			const code = `
        const found = await [1,2,3].find(async (x) => {
          if (x === 2) {
            return await atp.llm.call({ prompt: String(x) });
          }
          return false;
        });
      `;
			const result = compiler.transform(code);

			// 3 < 10 + conditional → batch
			expect(result.code).toContain('batchParallel');
		});

		test('some() - respects threshold', () => {
			const code = `
        const hasAny = await [1,2,3,4,5,6,7,8,9,10,11,12].some(async (x) => {
          if (x > 10) {
            return await atp.llm.call({ prompt: String(x) });
          }
          return false;
        });
      `;
			const result = compiler.transform(code);

			// 12 >= 10 + conditional → sequential
			expect(result.code).toContain('resumableSome');
		});

		test('every() - respects threshold', () => {
			const code = `
        const allValid = await [1,2,3].every(async (x) => {
          if (x > 0) {
            return await atp.llm.call({ prompt: String(x) });
          }
          return false;
        });
      `;
			const result = compiler.transform(code);

			// 3 < 10 + conditional → batch
			expect(result.code).toContain('batchParallel');
		});
	});

	describe('Edge Cases', () => {
		test('Empty array - still transforms', () => {
			const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });
			const code = `
        const results = await [].map(async (x) => {
          return await atp.llm.call({ prompt: String(x) });
        });
      `;
			const result = compiler.transform(code);

			// 0 < 10 → batch (even though empty)
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
		});

		test('Single item - batches if simple', () => {
			const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });
			const code = `
        const result = await [1].map(async (x) => {
          return await atp.llm.call({ prompt: String(x) });
        });
      `;
			const result_transform = compiler.transform(code);

			expect(result_transform.transformed).toBe(true);
			expect(result_transform.code).toContain('batchParallel');
		});

		test('Threshold = 0 means always sequential for conditionals', () => {
			const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 0 });
			const code = `
        const found = await [1].find(async (x) => {
          if (x > 0) {
            return await atp.llm.call({ prompt: String(x) });
          }
          return false;
        });
      `;
			const result = compiler.transform(code);

			// Even 1 item >= 0 → sequential with threshold 0
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('resumableFind');
		});

		test('Very high threshold means almost always batch', () => {
			const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 1000 });
			const array = Array.from({ length: 100 }, (_, i) => i + 1).join(',');
			const code = `
        const found = await [${array}].find(async (x) => {
          if (x > 50) {
            return await atp.llm.call({ prompt: String(x) });
          }
          return false;
        });
      `;
			const result = compiler.transform(code);

			// 100 < 1000 → batch
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
		});
	});
});

describe('for...of loop threshold tests', () => {
	const compiler = new ATPCompiler({ enableBatchParallel: true, batchSizeThreshold: 10 });

	it('should batch simple for...of (no conditionals) regardless of size', () => {
		const code = `
      async function test(items) {
        for (const item of items) {
          await atp.llm.call({ prompt: item });
        }
      }
    `;

		const result = compiler.transform(code);
		expect(result.code).toContain('batchParallel');
		expect(result.code).not.toContain('resumableForOf');
	});

	it('should batch for...of with conditional and literal small array', () => {
		const code = `
      async function test() {
        for (const item of [1, 2, 3, 4, 5]) {
          if (item > 2) {
            await atp.llm.call({ prompt: String(item) });
          }
        }
      }
    `;

		const result = compiler.transform(code);
		// Small literal array (5 < 10) → Batch
		expect(result.code).toContain('batchParallel');
		expect(result.code).not.toContain('resumableForOf');
	});

	it('should use sequential for...of with conditional and literal large array', () => {
		const code = `
      async function test() {
        for (const item of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]) {
          if (item > 5) {
            await atp.llm.call({ prompt: String(item) });
          }
        }
      }
    `;

		const result = compiler.transform(code);
		// Large literal array (15 >= 10) → Sequential
		expect(result.code).toContain('resumableForOf');
		expect(result.code).not.toContain('batchParallel');
	});

	it('should use sequential for...of with conditional and variable array', () => {
		const code = `
      async function test(items) {
        for (const item of items) {
          if (item.active) {
            await atp.llm.call({ prompt: item.name });
          }
        }
      }
    `;

		const result = compiler.transform(code);
		// Unknown size + conditionals → Sequential (conservative)
		expect(result.code).toContain('resumableForOf');
		expect(result.code).not.toContain('batchParallel');
	});

	it('should use sequential for...of with break statement', () => {
		const code = `
      async function test(items) {
        for (const item of items) {
          if (item.done) break;
          await atp.llm.call({ prompt: item });
        }
      }
    `;

		const result = compiler.transform(code);
		// break prevents batching
		expect(result.code).toContain('resumableForOf');
		expect(result.code).not.toContain('batchParallel');
	});
});

console.log('\n✅ SMART BATCHING THRESHOLD - ALL TESTS COMPLETE!\n');
