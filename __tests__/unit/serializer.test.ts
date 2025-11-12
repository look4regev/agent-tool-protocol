/**
 * Test for improved extractReferencedVars method
 */

import { describe, test, expect } from '@jest/globals';
import { Serializer } from '../../packages/server/src/instrumentation/serializer';

describe('Serializer - extractReferencedVars Improvements', () => {
	const serializer = new Serializer();

	test('should serialize function with closure correctly', () => {
		const multiplier = 10;
		const offset = 5;
		const fn = function calculate(x: number) {
			return x * multiplier + offset;
		};

		const scope = { multiplier, offset };
		const serialized = serializer.serialize(fn, scope);

		expect(serialized.type).toBe('function');
		expect(serialized.closure).toBeDefined();
		expect(serialized.closure).toHaveProperty('multiplier');
		expect(serialized.closure).toHaveProperty('offset');
	});

	test('should NOT capture JavaScript keywords', () => {
		const fn = function test() {
			const result = 42;
			if (result > 0) {
				return result;
			}
			return null;
		};

		const scope = {};
		const serialized = serializer.serialize(fn, scope);

		expect(serialized.type).toBe('function');
		expect(serialized.closure).toEqual({});
		// Keywords like 'const', 'if', 'return', 'null' should NOT be in closure
	});

	test('should NOT capture global built-ins', () => {
		const fn = function processData(data: any[]) {
			return data.map((x) => Math.floor(x * 2)).filter((x) => x > 0);
		};

		const scope = {};
		const serialized = serializer.serialize(fn, scope);

		expect(serialized.type).toBe('function');
		expect(serialized.closure).toEqual({});
		// Math, Array methods should NOT be captured
	});

	test('should capture actual closure variables', () => {
		const apiKey = 'secret-123';
		const baseUrl = 'https://api.example.com';
		const fn = function makeRequest(endpoint: string) {
			return `${baseUrl}/${endpoint}?key=${apiKey}`;
		};

		const scope = { apiKey, baseUrl };
		const serialized = serializer.serialize(fn, scope);

		expect(serialized.type).toBe('function');
		expect(serialized.closure).toBeDefined();
		expect(serialized.closure?.apiKey).toBeDefined();
		expect(serialized.closure?.baseUrl).toBeDefined();
	});

	test('should handle complex closures with nested objects', () => {
		const config = { timeout: 5000, retries: 3 };
		const handlers = { onSuccess: () => {}, onError: () => {} };

		const fn = function execute() {
			console.log('Config:', config);
			console.log('Handlers:', handlers);
			return config.timeout * config.retries;
		};

		const scope = { config, handlers };
		const serialized = serializer.serialize(fn, scope);

		expect(serialized.type).toBe('function');
		expect(serialized.closure).toHaveProperty('config');
		expect(serialized.closure).toHaveProperty('handlers');
		// 'console' should NOT be captured (it's a global)
	});

	test('should not confuse variable names with keywords', () => {
		// Variable named 'data' which is NOT a keyword
		const data = [1, 2, 3];
		const fn = function process() {
			return data.length;
		};

		const scope = { data };
		const serialized = serializer.serialize(fn, scope);

		expect(serialized.type).toBe('function');
		expect(serialized.closure).toHaveProperty('data');
	});

	test('should handle arrow functions with closures', () => {
		const factor = 2.5;
		const fn = (x: number) => x * factor;

		const scope = { factor };
		const serialized = serializer.serialize(fn, scope);

		expect(serialized.type).toBe('function');
		expect(serialized.closure).toHaveProperty('factor');
		expect(serialized.isArrow).toBe(true);
	});

	test('should handle async functions with closures', () => {
		const apiUrl = 'https://api.test.com';
		const fn = async function fetchData(id: string) {
			const response = await fetch(`${apiUrl}/items/${id}`);
			return response.json();
		};

		const scope = { apiUrl };
		const serialized = serializer.serialize(fn, scope);

		expect(serialized.type).toBe('function');
		expect(serialized.closure).toHaveProperty('apiUrl');
		expect(serialized.isAsync).toBe(true);
		// 'fetch', 'await', 'async' should NOT be in closure
	});

	test('should ignore variables not in scope', () => {
		const multiplier = 10;
		// Function references 'offset' but it's not in scope
		const fnSource = `function calculate(x) { return x * multiplier + offset; }`;
		const fn = eval(`(${fnSource})`);

		const scope = { multiplier }; // Only multiplier in scope
		const serialized = serializer.serialize(fn, scope);

		expect(serialized.type).toBe('function');
		expect(serialized.closure).toHaveProperty('multiplier');
		expect(serialized.closure).not.toHaveProperty('offset');
	});

	test('should handle functions with no closures', () => {
		const fn = function pureFunction(a: number, b: number) {
			return a + b;
		};

		const scope = {};
		const serialized = serializer.serialize(fn, scope);

		expect(serialized.type).toBe('function');
		expect(serialized.closure).toEqual({});
	});

	test('should handle special identifiers correctly', () => {
		// Test with 'arguments', 'this' which are special
		const customValue = 100;
		const fn = function useArguments() {
			const args = Array.from(arguments);
			return args.length + customValue;
		};

		const scope = { customValue };
		const serialized = serializer.serialize(fn, scope);

		expect(serialized.type).toBe('function');
		expect(serialized.closure).toHaveProperty('customValue');
		// 'arguments' and 'Array' should NOT be in closure
	});

	test('should deserialize function with closure correctly', () => {
		const multiplier = 3;
		const fn = function triple(x: number) {
			return x * multiplier;
		};

		const scope = { multiplier };
		const serialized = serializer.serialize(fn, scope);
		const deserialized = serializer.deserialize(serialized) as Function;

		expect(typeof deserialized).toBe('function');
		expect(deserialized(5)).toBe(15); // 5 * 3
	});

	test('performance: should handle functions with many identifiers', () => {
		// Generate a function with lots of variable references
		const scope: Record<string, number> = {};
		for (let i = 0; i < 100; i++) {
			scope[`var${i}`] = i;
		}

		const fnBody = Array.from({ length: 100 }, (_, i) => `var${i}`).join(' + ');
		const fn = new Function(...Object.keys(scope), `return ${fnBody};`);

		const startTime = Date.now();
		const serialized = serializer.serialize(fn, scope);
		const duration = Date.now() - startTime;

		expect(serialized.type).toBe('function');
		expect(Object.keys(serialized.closure || {}).length).toBe(100);
		expect(duration).toBeLessThan(100); // Should be fast (< 100ms)
	});
});
