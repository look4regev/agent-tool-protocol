/**
 * Tests for Batch Optimizer
 *
 * Verifies that simple callbacks are correctly identified as batchable
 * and complex callbacks fall back to sequential execution
 */

import { describe, test, expect } from '@jest/globals';
import * as parser from '@babel/parser';
import * as t from '@babel/types';
import { BatchOptimizer } from '../../src/transformer/batch-optimizer';

describe('BatchOptimizer', () => {
	const optimizer = new BatchOptimizer();

	describe('canBatchArrayMethod', () => {
		test('✅ Simple forEach with single LLM call - CAN BATCH', () => {
			const code = `async (item) => { await atp.llm.call({ prompt: item }); }`;
			const ast = parser.parseExpression(code);
			const callback = ast as t.Function;

			const result = optimizer.canBatchArrayMethod(callback);

			expect(result.canBatch).toBe(true);
			expect(result.llmCallPattern).toBe('single');
		});

		test('✅ Simple map with single LLM call - CAN BATCH', () => {
			const code = `async (item) => await atp.llm.call({ prompt: item })`;
			const ast = parser.parseExpression(code);
			const callback = ast as t.Function;

			const result = optimizer.canBatchArrayMethod(callback);

			expect(result.canBatch).toBe(true);
			expect(result.llmCallPattern).toBe('single');
		});

		test('✅ Arrow function with expression body - CAN BATCH', () => {
			const code = `async (x) => await atp.llm.call({ prompt: x })`;
			const ast = parser.parseExpression(code);
			const callback = ast as t.Function;

			const result = optimizer.canBatchArrayMethod(callback);

			expect(result.canBatch).toBe(true);
		});

		test('✅ forEach with conditional - CAN BATCH (smart decision later)', () => {
			const code = `async (item) => { 
        if (item.priority > 5) {
          await atp.llm.call({ prompt: item });
        }
      }`;
			const ast = parser.parseExpression(code);
			const callback = ast as t.Function;

			const result = optimizer.canBatchArrayMethod(callback);

			expect(result.canBatch).toBe(true);
			expect(result.hasConditionals).toBe(true);
			expect(result.llmCallPattern).toBe('conditional');
		});

		test('❌ forEach with loop inside - CANNOT BATCH', () => {
			const code = `async (item) => { 
        for (const x of item.parts) {
          await atp.llm.call({ prompt: x });
        }
      }`;
			const ast = parser.parseExpression(code);
			const callback = ast as t.Function;

			const result = optimizer.canBatchArrayMethod(callback);

			expect(result.canBatch).toBe(false);
			expect(result.reason).toBe('Contains loops');
		});

		test('❌ forEach with try-catch - CANNOT BATCH', () => {
			const code = `async (item) => { 
        try {
          await atp.llm.call({ prompt: item });
        } catch (e) {
          console.error(e);
        }
      }`;
			const ast = parser.parseExpression(code);
			const callback = ast as t.Function;

			const result = optimizer.canBatchArrayMethod(callback);

			expect(result.canBatch).toBe(false);
			expect(result.reason).toBe('Contains try-catch');
		});

		test('❌ forEach with sequential dependencies - CANNOT BATCH', () => {
			const code = `async (item) => { 
        const first = await atp.llm.call({ prompt: item });
        const second = await atp.llm.call({ prompt: first });
        return second;
      }`;
			const ast = parser.parseExpression(code);
			const callback = ast as t.Function;

			const result = optimizer.canBatchArrayMethod(callback);

			expect(result.canBatch).toBe(false);
			expect(result.reason).toBe('Multiple pausable calls');
		});

		test('❌ Non-async callback - CANNOT BATCH', () => {
			const code = `(item) => { console.log(item); }`;
			const ast = parser.parseExpression(code);
			const callback = ast as t.Function;

			const result = optimizer.canBatchArrayMethod(callback);

			expect(result.canBatch).toBe(false);
			expect(result.reason).toBe('Not async');
		});

		test('❌ No pausable calls - CANNOT BATCH', () => {
			const code = `async (item) => { await fetch(item); }`;
			const ast = parser.parseExpression(code);
			const callback = ast as t.Function;

			const result = optimizer.canBatchArrayMethod(callback);

			expect(result.canBatch).toBe(false);
			expect(result.reason).toBe('No pausable calls');
		});

		test('❌ Multiple independent LLM calls - CANNOT BATCH (too complex)', () => {
			const code = `async (item) => { 
        await atp.llm.call({ prompt: 'A' + item });
        await atp.llm.call({ prompt: 'B' + item });
      }`;
			const ast = parser.parseExpression(code);
			const callback = ast as t.Function;

			const result = optimizer.canBatchArrayMethod(callback);

			expect(result.canBatch).toBe(false);
			expect(result.reason).toBe('Multiple pausable calls');
		});
	});

	describe('canBatchForOfLoop', () => {
		test('✅ Simple for...of with single LLM call - CAN BATCH', () => {
			const code = `for (const item of items) { await atp.llm.call({ prompt: item }); }`;
			const ast = parser.parse(code, { sourceType: 'module' });
			const loop = ast.program.body[0] as t.ForOfStatement;

			const result = optimizer.canBatchForOfLoop(loop);

			expect(result.canBatch).toBe(true);
			expect(result.llmCallPattern).toBe('single');
		});

		test('❌ for...of with break - CANNOT BATCH', () => {
			const code = `for (const item of items) { 
        await atp.llm.call({ prompt: item });
        if (item === 'stop') break;
      }`;
			const ast = parser.parse(code, { sourceType: 'module' });
			const loop = ast.program.body[0] as t.ForOfStatement;

			const result = optimizer.canBatchForOfLoop(loop);

			expect(result.canBatch).toBe(false);
			expect(result.reason).toBe('Contains break/continue');
		});

		test('❌ for...of with continue - CANNOT BATCH', () => {
			const code = `for (const item of items) { 
        if (!item.valid) continue;
        await atp.llm.call({ prompt: item });
      }`;
			const ast = parser.parse(code, { sourceType: 'module' });
			const loop = ast.program.body[0] as t.ForOfStatement;

			const result = optimizer.canBatchForOfLoop(loop);

			expect(result.canBatch).toBe(false);
			expect(result.reason).toBe('Contains break/continue');
		});

		test('✅ for...of with conditional - CAN BATCH (smart decision later)', () => {
			const code = `for (const item of items) { 
        if (item.priority > 5) {
          await atp.llm.call({ prompt: item });
        }
      }`;
			const ast = parser.parse(code, { sourceType: 'module' });
			const loop = ast.program.body[0] as t.ForOfStatement;

			const result = optimizer.canBatchForOfLoop(loop);

			expect(result.canBatch).toBe(true);
			expect(result.hasConditionals).toBe(true);
		});

		test('❌ for...of with nested loop - CANNOT BATCH', () => {
			const code = `for (const outer of items) { 
        for (const inner of outer.items) {
          await atp.llm.call({ prompt: inner });
        }
      }`;
			const ast = parser.parse(code, { sourceType: 'module' });
			const loop = ast.program.body[0] as t.ForOfStatement;

			const result = optimizer.canBatchForOfLoop(loop);

			expect(result.canBatch).toBe(false);
			expect(result.reason).toBe('Contains nested loops');
		});
	});

	describe('Performance Impact Examples', () => {
		test('Example: 100 items with simple LLM call - WILL BE BATCHED', () => {
			const code = `async (item) => await atp.llm.call({ prompt: item })`;
			const ast = parser.parseExpression(code);
			const callback = ast as t.Function;

			const result = optimizer.canBatchArrayMethod(callback);

			expect(result.canBatch).toBe(true);
			// This means 100 items = 1 batch call (~2s) instead of 100 sequential (~200s)
			// 100x speedup!
		});

		test('Example: forEach with complex logic - WILL BE SEQUENTIAL', () => {
			const code = `async (item) => {
        if (item.needsReview) {
          const review = await atp.llm.call({ prompt: 'Review: ' + item });
          if (review.approved) {
            await atp.llm.call({ prompt: 'Finalize: ' + item });
          }
        }
      }`;
			const ast = parser.parseExpression(code);
			const callback = ast as t.Function;

			const result = optimizer.canBatchArrayMethod(callback);

			expect(result.canBatch).toBe(false);
			// Complex logic requires sequential execution with checkpoints
		});
	});
});

console.log('\n✅ Batch Optimizer tests complete!\n');
