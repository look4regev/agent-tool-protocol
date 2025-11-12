import * as t from '@babel/types';
import { generateUniqueId } from '../runtime/context.js';
import { getRuntimeMethodName } from './array-transformer-utils.js';

/**
 * Transform to sequential execution with checkpoints (fallback)
 */
export function transformToSequential(
	path: any,
	node: t.CallExpression,
	methodName: string,
	callback: t.Function,
	onTransform: () => void
): boolean {
	const runtimeMethod = getRuntimeMethodName(methodName);
	if (!runtimeMethod) {
		return false;
	}

	const methodId = generateUniqueId(methodName);
	const array = (node.callee as t.MemberExpression).object;
	const args: t.Expression[] = [array, callback as t.Expression, t.stringLiteral(methodId)];

	if (methodName === 'reduce' && node.arguments[1]) {
		args.push(node.arguments[1] as t.Expression);
	}

	const runtimeCall = t.awaitExpression(
		t.callExpression(
			t.memberExpression(t.identifier('__runtime'), t.identifier(runtimeMethod)),
			args
		)
	);

	path.replaceWith(runtimeCall);
	onTransform();
	return true;
}
