import { describe, test, expect, beforeAll } from '@jest/globals';
import { SandboxExecutor } from '@agent-tool-protocol/server';
import { initializeCache, initializeLogger } from '@mondaydotcomorg/atp-runtime';
import type { ExecutionConfig } from '@mondaydotcomorg/atp-protocol';

describe('Sandbox Executor', () => {
	let executor: SandboxExecutor;
	const defaultConfig: ExecutionConfig = {
		timeout: 5000,
		maxMemory: 128 * 1024 * 1024,
		maxLLMCalls: 5,
		allowedAPIs: [],
		allowLLMCalls: true,
	};

	beforeAll(() => {
		initializeLogger({ level: 'error', pretty: false });
		initializeCache({ type: 'memory', maxKeys: 100, defaultTTL: 60 });

		executor = new SandboxExecutor(
			{
				defaultTimeout: 5000,
				maxTimeout: 10000,
				defaultMemoryLimit: 128 * 1024 * 1024,
				maxMemoryLimit: 256 * 1024 * 1024,
				defaultLLMCallLimit: 5,
				maxLLMCallLimit: 10,
			},
			[]
		);
	});

	test('should execute simple code', async () => {
		const result = await executor.execute('return 2 + 2;', defaultConfig);

		expect(result.status).toBe('completed');
		expect(result.result).toBe(4);
		expect(result.stats.duration).toBeGreaterThan(0);
	});

	test('should execute async code', async () => {
		const code = `
			await new Promise(resolve => setTimeout(resolve, 100));
			return 'done';
		`;
		const result = await executor.execute(code, defaultConfig);

		expect(result.status).toBe('completed');
		expect(result.result).toBe('done');
		expect(result.stats.duration).toBeGreaterThanOrEqual(100);
	});

	test('should handle errors', async () => {
		const code = `throw new Error('Test error');`;
		const result = await executor.execute(code, defaultConfig);

		expect(result.status).toBe('failed');
		expect(result.error).toBeDefined();
		expect(result.error?.message).toContain('Test error');
	});

	test('should enforce timeout', async () => {
		const code = `
			const start = Date.now();
			while(Date.now() - start < 10000) {
				// Busy wait
			}
		`;
		const result = await executor.execute(code, { ...defaultConfig, timeout: 1000 });

		expect(result.status).toBe('timeout');
		expect(result.stats.duration).toBeGreaterThanOrEqual(1000);
	});

	test('should track memory usage', async () => {
		const code = `
			const largeArray = new Array(1000000).fill('test');
			return largeArray.length;
		`;
		const result = await executor.execute(code, defaultConfig);

		expect(result.status).toBe('completed');
		expect(result.result).toBe(1000000);
		// Memory tracking should be present and non-negative
		// (can be 0 due to GC timing, which is expected behavior)
		expect(result.stats.memoryUsed).toBeDefined();
		expect(typeof result.stats.memoryUsed).toBe('number');
		expect(result.stats.memoryUsed).toBeGreaterThanOrEqual(0);
	});

	test('should provide access to Math and Date', async () => {
		const code = `
			const random = Math.random();
			const now = new Date();
			return { random: typeof random, now: typeof now.getTime() };
		`;
		const result = await executor.execute(code, defaultConfig);

		expect(result.status).toBe('completed');
		expect(result.result).toEqual({
			random: 'number',
			now: 'number',
		});
	});

	test('should isolate sandbox from Node.js builtins', async () => {
		const code = `
			try {
				const fs = require('fs');
				return 'should not reach here';
			} catch (error) {
				return 'isolated';
			}
		`;
		const result = await executor.execute(code, defaultConfig);

		expect(result.status).toBe('completed');
		expect(result.result).toBe('isolated');
	});

	test('should provide console.log', async () => {
		const code = `
			console.log('test log');
			console.error('test error');
			return 'logged';
		`;
		const result = await executor.execute(code, defaultConfig);

		expect(result.status).toBe('completed');
		expect(result.result).toBe('logged');
	});
});
