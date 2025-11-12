import * as t from '@babel/types';
import { generateUniqueId } from '../runtime/context.js';
import { BatchParallelDetector } from './batch-detector.js';
import { findLLMCallExpression } from './array-transformer-utils.js';
import { wrapBatchResultIfNeeded } from './array-transformer-wrappers.js';

/**
 * Extract batch call info from callback
 */
export function extractBatchCallInfo(
	callback: t.Function,
	batchDetector: BatchParallelDetector
): {
	mapperFunction: t.ArrowFunctionExpression;
} | null {
	const paramName = callback.params[0];
	if (!t.isIdentifier(paramName)) {
		return null;
	}

	const param = paramName.name;

	const llmCall = findLLMCallExpression(callback.body);
	if (!llmCall) {
		return null;
	}

	const callInfo = batchDetector.extractCallInfo(llmCall);
	if (!callInfo) {
		return null;
	}

	const payloadNode = batchDetector.extractPayloadNode(llmCall);
	if (!payloadNode) {
		return null;
	}

	const mapperFunction = t.arrowFunctionExpression(
		[t.identifier(param)],
		t.objectExpression([
			t.objectProperty(t.identifier('type'), t.stringLiteral(callInfo.type)),
			t.objectProperty(t.identifier('operation'), t.stringLiteral(callInfo.operation)),
			t.objectProperty(t.identifier('payload'), payloadNode),
		])
	);

	return { mapperFunction };
}

/**
 * Transform simple array method to batch parallel execution
 */
export function transformToBatchParallel(
	path: any,
	node: t.CallExpression,
	methodName: string,
	callback: t.Function,
	batchDetector: BatchParallelDetector,
	onTransform: () => void,
	fallbackTransform: () => boolean
): boolean {
	const methodId = generateUniqueId(`${methodName}_batch`);
	const array = (node.callee as t.MemberExpression).object;

	const callInfo = extractBatchCallInfo(callback, batchDetector);
	if (!callInfo) {
		return fallbackTransform();
	}

	const batchCallsArray = t.callExpression(t.memberExpression(array, t.identifier('map')), [
		callInfo.mapperFunction,
	]);

	const batchCall = t.awaitExpression(
		t.callExpression(t.memberExpression(t.identifier('__runtime'), t.identifier('batchParallel')), [
			batchCallsArray,
			t.stringLiteral(methodId),
		])
	);

	const finalCall = wrapBatchResultIfNeeded(batchCall, methodName, array, methodId);

	path.replaceWith(finalCall);
	onTransform();
	return true;
}
