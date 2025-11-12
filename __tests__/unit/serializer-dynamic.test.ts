/**
 * Unit tests for dynamic Serializer improvements
 * Tests runtime detection of keywords and global built-ins
 */

import { Serializer } from '../../packages/server/src/instrumentation/serializer';

describe('Serializer - Dynamic Features', () => {
	describe('Configuration and Options', () => {
		it('should accept custom global built-ins', () => {
			const serializer = new Serializer({
				customGlobalBuiltIns: ['myCustomGlobal', 'anotherGlobal'],
			});

			// Properly create a function (not eval)
			const myCustomGlobal = 'global1';
			const anotherGlobal = 'global2';
			const localVar = 'local';
			const fn = function test() {
				return myCustomGlobal + anotherGlobal + localVar;
			};

			const result = serializer.serialize(fn, {
				myCustomGlobal, // Pass them in scope
				anotherGlobal,
				localVar,
			});

			// Custom globals should not be captured in closure
			expect(result.type).toBe('function');
			expect(result.closure).toBeDefined();
			expect(result.closure).not.toHaveProperty('myCustomGlobal');
			expect(result.closure).not.toHaveProperty('anotherGlobal');
			// But local variables should be captured
			expect(result.closure).toHaveProperty('localVar');
		});

		it('should work with caching enabled (default)', () => {
			const serializer = new Serializer({ enableCaching: true });

			const fn = function test() {
				return Math.PI + (Array.isArray([]) ? 1 : 0);
			};

			const result = serializer.serialize(fn, {});

			expect(result.type).toBe('function');
			expect(result.closure).not.toHaveProperty('Math');
			expect(result.closure).not.toHaveProperty('Array');
		});

		it('should work with caching disabled', () => {
			const serializer = new Serializer({ enableCaching: false });

			const fn = function test() {
				return Math.PI + (Array.isArray([]) ? 1 : 0);
			};

			const result = serializer.serialize(fn, {});

			expect(result.type).toBe('function');
			expect(result.closure).not.toHaveProperty('Math');
			expect(result.closure).not.toHaveProperty('Array');
		});
	});

	describe('Dynamic Keyword Detection', () => {
		it('should correctly identify JavaScript keywords', () => {
			const serializer = new Serializer();

			// Test function that uses keywords in various contexts
			const fn = function test() {
				const x = 1;
				let y = 2;
				var z = 3;
				if (true) {
					return x + y + z;
				}
				while (false) {}
				for (let i = 0; i < 10; i++) {}
				try {
				} catch (e) {}
			};

			const result = serializer.serialize(fn, {});

			expect(result.type).toBe('function');
			// Keywords should not be captured
			expect(result.closure).not.toHaveProperty('const');
			expect(result.closure).not.toHaveProperty('let');
			expect(result.closure).not.toHaveProperty('var');
			expect(result.closure).not.toHaveProperty('if');
			expect(result.closure).not.toHaveProperty('return');
			expect(result.closure).not.toHaveProperty('while');
			expect(result.closure).not.toHaveProperty('for');
			expect(result.closure).not.toHaveProperty('try');
			expect(result.closure).not.toHaveProperty('catch');
		});

		it('should handle async and await keywords', () => {
			const serializer = new Serializer();

			const fn = async function test() {
				await Promise.resolve();
				return true;
			};

			const result = serializer.serialize(fn, {});

			expect(result.type).toBe('function');
			expect(result.isAsync).toBe(true);
			expect(result.closure).not.toHaveProperty('async');
			expect(result.closure).not.toHaveProperty('await');
		});
	});

	describe('Dynamic Global Built-in Detection', () => {
		it('should detect standard JavaScript built-ins', () => {
			const serializer = new Serializer();

			const fn = function test() {
				return (
					Math.PI +
					(Array.isArray([]) ? 1 : 0) +
					Object.keys({}).length +
					String(123).length +
					Number('456') +
					(Boolean(true) ? 1 : 0) +
					Date.now() +
					JSON.stringify({}).length +
					(RegExp('test').test('test') ? 1 : 0)
				);
			};

			const result = serializer.serialize(fn, {});

			expect(result.type).toBe('function');
			expect(result.closure).not.toHaveProperty('Math');
			expect(result.closure).not.toHaveProperty('Array');
			expect(result.closure).not.toHaveProperty('Object');
			expect(result.closure).not.toHaveProperty('String');
			expect(result.closure).not.toHaveProperty('Number');
			expect(result.closure).not.toHaveProperty('Boolean');
			expect(result.closure).not.toHaveProperty('Date');
			expect(result.closure).not.toHaveProperty('JSON');
			expect(result.closure).not.toHaveProperty('RegExp');
		});

		it('should detect Node.js built-ins', () => {
			const serializer = new Serializer();

			const fn = function test() {
				console.log('test');
				return Buffer.from('test') + process.version;
			};

			const result = serializer.serialize(fn, {});

			expect(result.type).toBe('function');
			expect(result.closure).not.toHaveProperty('console');
			expect(result.closure).not.toHaveProperty('Buffer');
			expect(result.closure).not.toHaveProperty('process');
		});

		it('should detect ES6+ built-ins', () => {
			const serializer = new Serializer();

			const fn = function test() {
				const s = new Set([1, 2, 3]);
				const m = new Map([['a', 1]]);
				const ws = new WeakSet();
				const wm = new WeakMap();
				const p = Promise.resolve();
				return s.size + m.size;
			};

			const result = serializer.serialize(fn, {});

			expect(result.type).toBe('function');
			expect(result.closure).not.toHaveProperty('Set');
			expect(result.closure).not.toHaveProperty('Map');
			expect(result.closure).not.toHaveProperty('WeakSet');
			expect(result.closure).not.toHaveProperty('WeakMap');
			expect(result.closure).not.toHaveProperty('Promise');
		});

		it('should detect globalThis and global', () => {
			const serializer = new Serializer();

			const fn = function test() {
				return globalThis.Math.PI + (typeof global !== 'undefined' ? 1 : 0);
			};

			const result = serializer.serialize(fn, {});

			expect(result.type).toBe('function');
			expect(result.closure).not.toHaveProperty('globalThis');
			expect(result.closure).not.toHaveProperty('global');
		});
	});

	describe('Closure Variable Capture', () => {
		it('should capture only user-defined variables', () => {
			const serializer = new Serializer();

			const userVar = 'captured';
			const anotherUserVar = 42;

			const fn = function test() {
				return userVar + anotherUserVar + Math.PI;
			};

			const result = serializer.serialize(fn, {
				userVar,
				anotherUserVar,
			});

			expect(result.type).toBe('function');
			expect(result.closure).toHaveProperty('userVar');
			expect(result.closure).toHaveProperty('anotherUserVar');
			expect(result.closure).not.toHaveProperty('Math');
		});

		it('should handle mixed scope variables', () => {
			const serializer = new Serializer();

			const captured = 'test'; // Declare it
			const fn = function test() {
				const local = 1;
				return local + captured + Math.random();
			};

			const result = serializer.serialize(fn, {
				captured: 'test',
			});

			expect(result.type).toBe('function');
			expect(result.closure).toHaveProperty('captured');
			expect(result.closure).not.toHaveProperty('local');
			expect(result.closure).not.toHaveProperty('Math');
		});

		it('should not capture variables that shadow globals', () => {
			const serializer = new Serializer();

			const fn = function test() {
				const Array = 'not the real Array';
				return Array + ' ' + String;
			};

			const result = serializer.serialize(fn, {});

			expect(result.type).toBe('function');
			// Both 'Array' and 'String' should be skipped
			// 'Array' is in scope but references a local const
			// 'String' is a global built-in
			expect(result.closure).not.toHaveProperty('String');
		});
	});

	describe('Extended Primitive Types', () => {
		it('should handle bigint primitives', () => {
			const serializer = new Serializer();

			const bigintValue = BigInt(123456789012345678901234567890n);
			const result = serializer.serialize(bigintValue);

			expect(result.type).toBe('primitive');
			expect(result.value).toBe('123456789012345678901234567890n');
		});

		it('should handle symbol primitives', () => {
			const serializer = new Serializer();

			const symbolValue = Symbol('test');
			const result = serializer.serialize(symbolValue);

			expect(result.type).toBe('primitive');
			expect(result.value).toContain('Symbol(test)');
		});
	});

	describe('Caching Performance', () => {
		it('should cache keyword checks', () => {
			const serializer = new Serializer({ enableCaching: true });

			// Create multiple functions with the same keywords
			const fn1 = function test1() {
				if (true) return 1;
			};
			const fn2 = function test2() {
				if (false) return 2;
			};

			const result1 = serializer.serialize(fn1, {});
			const result2 = serializer.serialize(fn2, {});

			expect(result1.type).toBe('function');
			expect(result2.type).toBe('function');
			// Both should work correctly (cache doesn't break functionality)
			expect(result1.closure).not.toHaveProperty('if');
			expect(result2.closure).not.toHaveProperty('if');
		});

		it('should cache global built-in checks', () => {
			const serializer = new Serializer({ enableCaching: true });

			// Create multiple functions with the same globals
			const fn1 = function test1() {
				return Math.PI;
			};
			const fn2 = function test2() {
				return Math.E;
			};
			const fn3 = function test3() {
				return Math.random();
			};

			const result1 = serializer.serialize(fn1, {});
			const result2 = serializer.serialize(fn2, {});
			const result3 = serializer.serialize(fn3, {});

			// All should work correctly with cached global detection
			expect(result1.closure).not.toHaveProperty('Math');
			expect(result2.closure).not.toHaveProperty('Math');
			expect(result3.closure).not.toHaveProperty('Math');
		});
	});

	describe('Edge Cases', () => {
		it('should handle function with no external references', () => {
			const serializer = new Serializer();

			const fn = function test() {
				const x = 1;
				const y = 2;
				return x + y;
			};

			const result = serializer.serialize(fn, {});

			expect(result.type).toBe('function');
			expect(result.closure).toEqual({});
		});

		it('should handle function with only global references', () => {
			const serializer = new Serializer();

			const fn = function test() {
				return Math.PI + (Array.isArray([]) ? 1 : 0) + Object.keys({}).length;
			};

			const result = serializer.serialize(fn, {});

			expect(result.type).toBe('function');
			expect(result.closure).toEqual({});
		});

		it('should handle arrow functions', () => {
			const serializer = new Serializer();

			const capturedVar = 'test';
			const fn = () => capturedVar + Math.PI;

			const result = serializer.serialize(fn, { capturedVar });

			expect(result.type).toBe('function');
			expect(result.isArrow).toBe(true);
			expect(result.closure).toHaveProperty('capturedVar');
			expect(result.closure).not.toHaveProperty('Math');
		});

		it('should handle generator functions', () => {
			const serializer = new Serializer();

			const capturedVar = 'test';
			const fn = function* test() {
				yield capturedVar;
				yield Math.PI;
			};

			const result = serializer.serialize(fn, { capturedVar });

			expect(result.type).toBe('function');
			expect(result.isGenerator).toBe(true);
			expect(result.closure).toHaveProperty('capturedVar');
			expect(result.closure).not.toHaveProperty('Math');
		});

		it('should handle async arrow functions', () => {
			const serializer = new Serializer();

			const capturedVar = 'test';
			const fn = async () => {
				await Promise.resolve();
				return capturedVar + Math.PI;
			};

			const result = serializer.serialize(fn, { capturedVar });

			expect(result.type).toBe('function');
			expect(result.isAsync).toBe(true);
			expect(result.isArrow).toBe(true);
			expect(result.closure).toHaveProperty('capturedVar');
			expect(result.closure).not.toHaveProperty('Promise');
			expect(result.closure).not.toHaveProperty('Math');
		});
	});

	describe('Backward Compatibility', () => {
		it('should work without any options (default behavior)', () => {
			const serializer = new Serializer();

			const fn = function test() {
				return Math.PI + (Array.isArray([]) ? 1 : 0);
			};

			const result = serializer.serialize(fn, {});

			expect(result.type).toBe('function');
			expect(result.closure).toEqual({});
		});

		it('should maintain existing serialization behavior', () => {
			const serializer = new Serializer();

			// Test all existing types
			const tests = [
				{ value: null, expectedType: 'primitive' },
				{ value: undefined, expectedType: 'primitive' },
				{ value: 'string', expectedType: 'primitive' },
				{ value: 123, expectedType: 'primitive' },
				{ value: true, expectedType: 'primitive' },
				{ value: new Date(), expectedType: 'date' },
				{ value: /test/, expectedType: 'regexp' },
				{ value: [1, 2, 3], expectedType: 'array' },
				{ value: new Map(), expectedType: 'map' },
				{ value: new Set(), expectedType: 'set' },
				{ value: { a: 1 }, expectedType: 'object' },
				{ value: () => {}, expectedType: 'function' },
			];

			for (const test of tests) {
				const result = serializer.serialize(test.value);
				expect(result.type).toBe(test.expectedType);
			}
		});
	});
});
