import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
// @ts-ignore - CommonJS/ESM compatibility
const traverse =
	typeof (_traverse as any).default === 'function' ? (_traverse as any).default : _traverse;
import * as t from '@babel/types';
import type { DetectionResult, AsyncPattern } from '../types.js';
import { containsAwait, isArrayMethod, isPausableCallExpression } from './utils.js';

export class AsyncIterationDetector {
	detect(code: string): DetectionResult {
		const patterns: AsyncPattern[] = [];
		let batchableParallel = false;

		try {
			const ast = parse(code, {
				sourceType: 'module',
				plugins: ['typescript'],
				allowAwaitOutsideFunction: true,
				allowReturnOutsideFunction: true,
			});

			traverse(ast, {
				ForOfStatement: (path: any) => {
					if (containsAwait(path.node.body)) {
						patterns.push('for-of-await');
					}
				},

				WhileStatement: (path: any) => {
					if (containsAwait(path.node.body)) {
						patterns.push('while-await');
					}
				},

				CallExpression: (path: any) => {
					const node = path.node;

					if (isArrayMethod(node, 'map')) {
						const callback = node.arguments[0];
						if (callback && t.isFunction(callback) && callback.async) {
							patterns.push('map-async');
						}
					}

					if (isArrayMethod(node, 'forEach')) {
						const callback = node.arguments[0];
						if (callback && t.isFunction(callback) && callback.async) {
							patterns.push('forEach-async');
						}
					}

					if (isArrayMethod(node, 'filter')) {
						const callback = node.arguments[0];
						if (callback && t.isFunction(callback) && callback.async) {
							patterns.push('filter-async');
						}
					}

					if (isArrayMethod(node, 'reduce')) {
						const callback = node.arguments[0];
						if (callback && t.isFunction(callback) && callback.async) {
							patterns.push('reduce-async');
						}
					}

					if (isArrayMethod(node, 'find')) {
						const callback = node.arguments[0];
						if (callback && t.isFunction(callback) && callback.async) {
							patterns.push('find-async');
						}
					}

					if (isArrayMethod(node, 'some')) {
						const callback = node.arguments[0];
						if (callback && t.isFunction(callback) && callback.async) {
							patterns.push('some-async');
						}
					}

					if (isArrayMethod(node, 'every')) {
						const callback = node.arguments[0];
						if (callback && t.isFunction(callback) && callback.async) {
							patterns.push('every-async');
						}
					}

					if (isArrayMethod(node, 'flatMap')) {
						const callback = node.arguments[0];
						if (callback && t.isFunction(callback) && callback.async) {
							patterns.push('flatMap-async');
						}
					}

					if (this.isPromiseAll(node)) {
						patterns.push('promise-all');
						if (this.canBatchPromiseAll(node)) {
							batchableParallel = true;
						}
					}

					if (this.isPromiseAllSettled(node)) {
						patterns.push('promise-allSettled');
					}
				},
			});

			return {
				needsTransform: patterns.length > 0,
				patterns: [...new Set(patterns)],
				batchableParallel,
			};
		} catch (error) {
			return {
				needsTransform: false,
				patterns: [],
				batchableParallel: false,
			};
		}
	}

	private isPromiseAll(node: t.CallExpression): boolean {
		const callee = node.callee;
		return (
			t.isMemberExpression(callee) &&
			t.isIdentifier(callee.object, { name: 'Promise' }) &&
			t.isIdentifier(callee.property, { name: 'all' })
		);
	}

	private isPromiseAllSettled(node: t.CallExpression): boolean {
		const callee = node.callee;
		return (
			t.isMemberExpression(callee) &&
			t.isIdentifier(callee.object, { name: 'Promise' }) &&
			t.isIdentifier(callee.property, { name: 'allSettled' })
		);
	}

	private canBatchPromiseAll(node: t.CallExpression): boolean {
		const arrayArg = node.arguments[0];

		if (!t.isArrayExpression(arrayArg)) {
			return false;
		}

		if (arrayArg.elements.length === 0) {
			return false;
		}

		return arrayArg.elements.every((el) => {
			if (!el || t.isSpreadElement(el)) {
				return false;
			}

			return this.isDirectPausableCall(el);
		});
	}

	private isDirectPausableCall(node: t.Node): boolean {
		if (t.isAwaitExpression(node)) {
			node = node.argument;
		}

		if (!t.isCallExpression(node)) {
			return false;
		}

		return isPausableCallExpression(node);
	}
}
