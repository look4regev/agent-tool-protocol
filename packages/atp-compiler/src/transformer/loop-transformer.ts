import * as t from '@babel/types';
import { generateUniqueId } from '../runtime/context.js';
import { containsAwait } from './utils.js';
import { BatchOptimizer } from './batch-optimizer.js';
import { BatchParallelDetector } from './batch-detector.js';

export class LoopTransformer {
	private transformCount = 0;
	private batchOptimizer: BatchOptimizer;
	private batchDetector: BatchParallelDetector;
	private batchSizeThreshold: number;

	constructor(batchSizeThreshold: number = 10) {
		this.batchOptimizer = new BatchOptimizer();
		this.batchDetector = new BatchParallelDetector();
		this.batchSizeThreshold = batchSizeThreshold;
	}

	transformForOfLoop(path: any): boolean {
		const node = path.node as t.ForOfStatement;

		if (!containsAwait(node.body)) {
			return false;
		}

		const batchResult = this.batchOptimizer.canBatchForOfLoop(node);

		if (batchResult.canBatch) {
			const decision = this.batchOptimizer.makeSmartBatchDecision(
				'for...of',
				batchResult,
				node.right,
				this.batchSizeThreshold
			);

			if (decision.shouldBatch) {
				return this.transformForOfToBatch(path, node);
			}
		}

		return this.transformForOfToSequential(path, node);
	}

	/**
	 * Transform simple for...of to batch parallel
	 */
	private transformForOfToBatch(path: any, node: t.ForOfStatement): boolean {
		const loopId = generateUniqueId('for_of_batch');
		const left = node.left;
		const right = node.right;

		let paramName: string;
		if (t.isVariableDeclaration(left)) {
			const id = left.declarations[0]?.id;
			paramName = t.isIdentifier(id) ? id.name : 'item';
		} else if (t.isIdentifier(left)) {
			paramName = left.name;
		} else {
			paramName = 'item';
		}

		const bodyStatements = t.isBlockStatement(node.body) ? node.body.body : [node.body];
		const callback = t.arrowFunctionExpression(
			[t.identifier(paramName)],
			t.blockStatement(bodyStatements),
			true
		);

		const llmCall = this.findLLMCallInBody(node.body);
		if (!llmCall) {
			return this.transformForOfToSequential(path, node);
		}

		const callInfo = this.batchDetector.extractCallInfo(llmCall);
		if (!callInfo) {
			return this.transformForOfToSequential(path, node);
		}

		const payloadNode = this.batchDetector.extractPayloadNode(llmCall);
		if (!payloadNode) {
			return this.transformForOfToSequential(path, node);
		}

		const batchCallsArray = t.callExpression(t.memberExpression(right, t.identifier('map')), [
			t.arrowFunctionExpression(
				[t.identifier(paramName)],
				t.objectExpression([
					t.objectProperty(t.identifier('type'), t.stringLiteral(callInfo.type)),
					t.objectProperty(t.identifier('operation'), t.stringLiteral(callInfo.operation)),
					t.objectProperty(t.identifier('payload'), payloadNode),
				])
			),
		]);

		const batchCall = t.awaitExpression(
			t.callExpression(
				t.memberExpression(t.identifier('__runtime'), t.identifier('batchParallel')),
				[batchCallsArray, t.stringLiteral(loopId)]
			)
		);

		path.replaceWith(t.expressionStatement(batchCall));
		this.transformCount++;
		return true;
	}

	/**
	 * Transform for...of to sequential with checkpoints (fallback)
	 */
	private transformForOfToSequential(path: any, node: t.ForOfStatement): boolean {
		const loopId = generateUniqueId('for_of');
		const left = node.left;
		const right = node.right;

		let paramName: string;
		if (t.isVariableDeclaration(left)) {
			const id = left.declarations[0]?.id;
			paramName = t.isIdentifier(id) ? id.name : 'item';
		} else if (t.isIdentifier(left)) {
			paramName = left.name;
		} else {
			paramName = 'item';
		}

		const bodyStatements = t.isBlockStatement(node.body) ? node.body.body : [node.body];

		const callbackFn = t.arrowFunctionExpression(
			[t.identifier(paramName), t.identifier('__index')],
			t.blockStatement(bodyStatements),
			true
		);

		const runtimeCall = t.awaitExpression(
			t.callExpression(
				t.memberExpression(t.identifier('__runtime'), t.identifier('resumableForOf')),
				[right, callbackFn, t.stringLiteral(loopId)]
			)
		);

		path.replaceWith(t.expressionStatement(runtimeCall));
		this.transformCount++;
		return true;
	}

	/**
	 * Find LLM call in loop body
	 */
	private findLLMCallInBody(body: t.Statement | t.BlockStatement): t.CallExpression | null {
		let found: t.CallExpression | null = null;

		const visit = (node: t.Node) => {
			if (found) return;

			if (t.isAwaitExpression(node) && t.isCallExpression(node.argument)) {
				const call = node.argument;
				if (t.isMemberExpression(call.callee)) {
					found = call;
					return;
				}
			}

			Object.keys(node).forEach((key) => {
				const value = (node as any)[key];
				if (Array.isArray(value)) {
					value.forEach((item) => {
						if (item && typeof item === 'object' && item.type) {
							visit(item);
						}
					});
				} else if (value && typeof value === 'object' && value.type) {
					visit(value);
				}
			});
		};

		visit(body);
		return found;
	}

	transformWhileLoop(path: any): boolean {
		const node = path.node as t.WhileStatement;

		if (!containsAwait(node.body)) {
			return false;
		}

		const loopId = generateUniqueId('while');

		const conditionFn = t.arrowFunctionExpression([], node.test, false);

		const bodyStatements = t.isBlockStatement(node.body) ? node.body.body : [node.body];

		const bodyFn = t.arrowFunctionExpression(
			[t.identifier('__iteration')],
			t.blockStatement(bodyStatements),
			true
		);

		const runtimeCall = t.awaitExpression(
			t.callExpression(
				t.memberExpression(t.identifier('__runtime'), t.identifier('resumableWhile')),
				[conditionFn, bodyFn, t.stringLiteral(loopId)]
			)
		);

		path.replaceWith(t.expressionStatement(runtimeCall));
		this.transformCount++;
		return true;
	}

	transformForLoop(path: any): boolean {
		const node = path.node as t.ForStatement;

		if (!containsAwait(node.body)) {
			return false;
		}

		if (!node.init || !node.test || !node.update) {
			return false;
		}

		const loopId = generateUniqueId('for');

		let initValue: t.Expression = t.numericLiteral(0);
		let loopVar = '__i';

		if (t.isVariableDeclaration(node.init)) {
			const decl = node.init.declarations[0];
			if (decl && t.isIdentifier(decl.id) && decl.init) {
				loopVar = decl.id.name;
				initValue = decl.init;
			}
		}

		const conditionFn = t.arrowFunctionExpression([t.identifier(loopVar)], node.test, false);

		const bodyStatements = t.isBlockStatement(node.body) ? node.body.body : [node.body];

		const bodyFn = t.arrowFunctionExpression(
			[t.identifier(loopVar)],
			t.blockStatement(bodyStatements),
			true
		);

		let incrementFn: t.Expression;
		if (t.isUpdateExpression(node.update)) {
			if (node.update.operator === '++') {
				incrementFn = t.arrowFunctionExpression(
					[t.identifier(loopVar)],
					t.binaryExpression('+', t.identifier(loopVar), t.numericLiteral(1)),
					false
				);
			} else if (node.update.operator === '--') {
				incrementFn = t.arrowFunctionExpression(
					[t.identifier(loopVar)],
					t.binaryExpression('-', t.identifier(loopVar), t.numericLiteral(1)),
					false
				);
			} else {
				return false;
			}
		} else {
			return false;
		}

		const runtimeCall = t.awaitExpression(
			t.callExpression(
				t.memberExpression(t.identifier('__runtime'), t.identifier('resumableForLoop')),
				[initValue, conditionFn, incrementFn, bodyFn, t.stringLiteral(loopId)]
			)
		);

		path.replaceWith(t.expressionStatement(runtimeCall));
		this.transformCount++;
		return true;
	}

	getTransformCount(): number {
		return this.transformCount;
	}

	resetTransformCount(): void {
		this.transformCount = 0;
	}
}
