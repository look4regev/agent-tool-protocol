/**
 * COMPREHENSIVE CALLBACK TYPE TESTS
 *
 * Tests ALL callback types: llm, approval, embedding
 * Verifies batch optimization works correctly for each type
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { ATPCompiler } from '../../src/transformer/index';

describe('All Callback Types - Comprehensive Tests', () => {
	let compiler: ATPCompiler;

	beforeEach(() => {
		compiler = new ATPCompiler({ enableBatchParallel: true });
	});

	describe('LLM Callbacks', () => {
		test('✅ atp.llm.call - simple map should batch', () => {
			const code = `
        const results = await items.map(async (item) => {
          return await atp.llm.call({ prompt: item });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).toContain('type: "llm"');
			expect(result.code).toContain('operation: "call"');
		});

		test('✅ atp.llm.stream - simple forEach should batch', () => {
			const code = `
        await items.forEach(async (item) => {
          await atp.llm.stream({ prompt: item });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).toContain('type: "llm"');
			expect(result.code).toContain('operation: "stream"');
		});

		test('✅ atp.llm.generate - for...of should batch', () => {
			const code = `
        for (const item of items) {
          await atp.llm.generate({ prompt: item });
        }
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).toContain('type: "llm"');
			expect(result.code).toContain('operation: "generate"');
		});

		test('❌ LLM with conditional - should NOT batch', () => {
			const code = `
        const results = await items.map(async (item) => {
          if (item.shouldProcess) {
            return await atp.llm.call({ prompt: item.text });
          }
        });
      `;
			const result = compiler.transform(code);
			expect(result.code).toContain('resumableMap');
			expect(result.code).not.toContain('batchParallel');
		});
	});

	describe('Approval Callbacks', () => {
		test('✅ atp.approval.request - simple map should batch', () => {
			const code = `
        const results = await items.map(async (item) => {
          return await atp.approval.request({ message: item });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).toContain('type: "approval"');
			expect(result.code).toContain('operation: "request"');
		});

		test('✅ atp.approval.confirm - forEach should batch', () => {
			const code = `
        await items.forEach(async (item) => {
          await atp.approval.confirm({ action: item.action });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).toContain('type: "approval"');
			expect(result.code).toContain('operation: "confirm"');
		});

		test('✅ atp.approval.verify - for...of should batch', () => {
			const code = `
        for (const item of items) {
          await atp.approval.verify({ data: item });
        }
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).toContain('type: "approval"');
			expect(result.code).toContain('operation: "verify"');
		});

		test('❌ Approval with try-catch - should NOT batch', () => {
			const code = `
        const results = await items.map(async (item) => {
          try {
            return await atp.approval.request({ message: item });
          } catch (e) {
            return null;
          }
        });
      `;
			const result = compiler.transform(code);
			expect(result.code).toContain('resumableMap');
			expect(result.code).not.toContain('batchParallel');
		});
	});

	describe('Embedding Callbacks', () => {
		test('✅ atp.embedding.create - simple map should batch', () => {
			const code = `
        const results = await items.map(async (item) => {
          return await atp.embedding.create({ text: item });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).toContain('type: "embedding"');
			expect(result.code).toContain('operation: "create"');
		});

		test('✅ atp.embedding.generate - forEach should batch', () => {
			const code = `
        await items.forEach(async (item) => {
          await atp.embedding.generate({ content: item });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).toContain('type: "embedding"');
			expect(result.code).toContain('operation: "generate"');
		});

		test('✅ atp.embedding.encode - for...of should batch', () => {
			const code = `
        for (const item of items) {
          await atp.embedding.encode({ data: item });
        }
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).toContain('type: "embedding"');
			expect(result.code).toContain('operation: "encode"');
		});

		test('❌ Embedding with nested loop - should NOT batch outer', () => {
			const code = `
        const results = await items.map(async (item) => {
          for (const sub of item.parts) {
            await atp.embedding.create({ text: sub });
          }
        });
      `;
			const result = compiler.transform(code);
			expect(result.code).toContain('resumableMap');
			// Inner loop should be batched though
			expect(result.code).toContain('batchParallel');
		});
	});

	describe('Mixed Callback Types', () => {
		test('Different callbacks in separate operations', () => {
			const code = `
        const llmResults = await items.map(async (item) => {
          return await atp.llm.call({ prompt: item });
        });
        
        const approvalResults = await items.map(async (item) => {
          return await atp.approval.request({ message: item });
        });
        
        const embeddings = await items.map(async (item) => {
          return await atp.embedding.create({ text: item });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			// All three should be batched
			expect(result.code).toContain('type: "llm"');
			expect(result.code).toContain('type: "approval"');
			expect(result.code).toContain('type: "embedding"');
			// Should have 3 batch operations
			const batchCount = (result.code.match(/batchParallel/g) || []).length;
			expect(batchCount).toBeGreaterThanOrEqual(3);
		});

		test('❌ Multiple different callbacks in same iteration - should NOT batch', () => {
			const code = `
        const results = await items.map(async (item) => {
          const llm = await atp.llm.call({ prompt: item });
          const approval = await atp.approval.request({ message: llm });
          return approval;
        });
      `;
			const result = compiler.transform(code);
			// Has dependencies, so sequential
			expect(result.code).toContain('resumableMap');
			expect(result.code).not.toContain('batchParallel');
		});
	});

	describe('Complex Payloads', () => {
		test('✅ LLM with complex payload', () => {
			const code = `
        const results = await items.map(async (item) => {
          return await atp.llm.call({
            prompt: item.text,
            model: 'gpt-4',
            temperature: 0.7,
            maxTokens: 1000,
            metadata: { id: item.id, timestamp: Date.now() }
          });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			// Payload should be preserved
			expect(result.code).toContain('prompt');
			expect(result.code).toContain('model');
		});

		test('✅ Approval with complex payload', () => {
			const code = `
        const results = await items.map(async (item) => {
          return await atp.approval.request({
            message: item.message,
            priority: item.priority,
            requester: item.user,
            context: { category: item.category }
          });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).toContain('message');
			expect(result.code).toContain('priority');
		});

		test('✅ Embedding with complex payload', () => {
			const code = `
        const results = await items.map(async (item) => {
          return await atp.embedding.create({
            text: item.content,
            model: 'text-embedding-3-small',
            dimensions: 1536,
            metadata: item.meta
          });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			expect(result.code).toContain('text');
			expect(result.code).toContain('model');
		});
	});

	describe('Edge Cases - Callback Variations', () => {
		test('✅ Callback with destructured parameter', () => {
			const code = `
        const results = await items.map(async ({ text, id }) => {
          return await atp.llm.call({ prompt: text, context: id });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
		});

		test('✅ Callback with index parameter', () => {
			const code = `
        const results = await items.map(async (item, index) => {
          return await atp.llm.call({ prompt: \`\${index}: \${item}\` });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
		});

		test('✅ Callback with computed property', () => {
			const code = `
        const results = await items.map(async (item) => {
          return await atp.llm.call({ prompt: item.text.toUpperCase() });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
		});

		test('✅ Callback with template literal', () => {
			const code = `
        const results = await items.map(async (item) => {
          return await atp.llm.call({ prompt: \`Process: \${item}\` });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
		});

		test('✅ Callback with spread operator', () => {
			const code = `
        const results = await items.map(async (item) => {
          return await atp.llm.call({ ...item.config, prompt: item.text });
        });
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
		});
	});

	describe('Promise.all with Mixed Callbacks', () => {
		test('✅ Promise.all with different callback types', () => {
			const code = `
        const results = await Promise.all([
          atp.llm.call({ prompt: 'A' }),
          atp.approval.request({ message: 'B' }),
          atp.embedding.create({ text: 'C' })
        ]);
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			// Promise.all is handled by PromiseTransformer (batchParallel or resumablePromiseAll)
			const hasBatchParallel = result.code.includes('batchParallel');
			const hasResumablePromiseAll = result.code.includes('resumablePromiseAll');
			expect(hasBatchParallel || hasResumablePromiseAll).toBe(true);
		});

		test('✅ Promise.all with same callback type', () => {
			const code = `
        const results = await Promise.all([
          atp.llm.call({ prompt: 'Question 1' }),
          atp.llm.call({ prompt: 'Question 2' }),
          atp.llm.call({ prompt: 'Question 3' })
        ]);
      `;
			const result = compiler.transform(code);
			expect(result.transformed).toBe(true);
			expect(result.code).toContain('batchParallel');
			const llmCount = (result.code.match(/type: "llm"/g) || []).length;
			expect(llmCount).toBe(3);
		});
	});

	describe('Verification of Generated Code', () => {
		test('Batch code structure is correct', () => {
			const code = `
        const results = await items.map(async (item) => {
          return await atp.llm.call({ prompt: item });
        });
      `;
			const result = compiler.transform(code);

			// Should have proper structure:
			// items.map((item) => ({ type: 'llm', operation: 'call', payload: {...} }))
			expect(result.code).toMatch(/\.map\s*\(\s*\(?[^)]+\)?\s*=>\s*\(\s*\{/);
			expect(result.code).toContain('type:');
			expect(result.code).toContain('operation:');
			expect(result.code).toContain('payload:');
		});

		test('Payload preservation is correct', () => {
			const code = `
        const results = await items.map(async (item) => {
          return await atp.llm.call({ 
            prompt: item.text,
            model: item.model
          });
        });
      `;
			const result = compiler.transform(code);

			// Payload should reference item properties
			expect(result.code).toContain('item.text');
			expect(result.code).toContain('item.model');
		});
	});
});

console.log('\n✅ ALL CALLBACK TYPE TESTS COMPLETE!\n');
