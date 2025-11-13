import * as t from '@babel/types';

/**
 * Wrap batch result with post-processing for filter()
 * Filter must return filtered ITEMS, not boolean results
 */
export function wrapFilterResult(
	batchCall: t.AwaitExpression,
	array: t.Expression,
	methodId: string
): t.Expression {
	const resultsVar = `__filter_results_${methodId}`;
	const indexVar = `__i_${methodId}`;
	const arrayClone = t.cloneNode(array, true);

	return t.awaitExpression(
		t.callExpression(
			t.arrowFunctionExpression(
				[],
				t.blockStatement([
					t.variableDeclaration('const', [
						t.variableDeclarator(t.identifier(resultsVar), batchCall.argument),
					]),
					t.returnStatement(
						t.callExpression(t.memberExpression(arrayClone, t.identifier('filter')), [
							t.arrowFunctionExpression(
								[t.identifier('_'), t.identifier(indexVar)],
								t.callExpression(t.identifier('Boolean'), [
									t.memberExpression(t.identifier(resultsVar), t.identifier(indexVar), true),
								])
							),
						])
					),
				]),
				true
			),
			[]
		)
	);
}

/**
 * Wrap batch result with post-processing for find()
 * Find must return first matching ITEM (not boolean)
 */
export function wrapFindResult(
	batchCall: t.AwaitExpression,
	array: t.Expression,
	methodId: string
): t.Expression {
	const resultsVar = `__find_results_${methodId}`;
	const arrayClone = t.cloneNode(array, true);

	return t.awaitExpression(
		t.callExpression(
			t.arrowFunctionExpression(
				[],
				t.blockStatement([
					t.variableDeclaration('const', [
						t.variableDeclarator(t.identifier(resultsVar), batchCall.argument),
					]),
					t.returnStatement(
						t.callExpression(t.memberExpression(arrayClone, t.identifier('find')), [
							t.arrowFunctionExpression(
								[t.identifier('_'), t.identifier('__i')],
								t.callExpression(t.identifier('Boolean'), [
									t.memberExpression(t.identifier(resultsVar), t.identifier('__i'), true),
								])
							),
						])
					),
				]),
				true
			),
			[]
		)
	);
}

/**
 * Wrap batch result with post-processing for some()
 * Some must return boolean: true if ANY result is truthy
 */
export function wrapSomeResult(batchCall: t.AwaitExpression, methodId: string): t.Expression {
	const resultsVar = `__some_results_${methodId}`;

	return t.awaitExpression(
		t.callExpression(
			t.arrowFunctionExpression(
				[],
				t.blockStatement([
					t.variableDeclaration('const', [
						t.variableDeclarator(t.identifier(resultsVar), batchCall.argument),
					]),
					t.returnStatement(
						t.callExpression(t.memberExpression(t.identifier(resultsVar), t.identifier('some')), [
							t.arrowFunctionExpression(
								[t.identifier('r')],
								t.callExpression(t.identifier('Boolean'), [t.identifier('r')])
							),
						])
					),
				]),
				true
			),
			[]
		)
	);
}

/**
 * Wrap batch result with post-processing for every()
 * Every must return boolean: true if ALL results are truthy
 */
export function wrapEveryResult(batchCall: t.AwaitExpression, methodId: string): t.Expression {
	const resultsVar = `__every_results_${methodId}`;

	return t.awaitExpression(
		t.callExpression(
			t.arrowFunctionExpression(
				[],
				t.blockStatement([
					t.variableDeclaration('const', [
						t.variableDeclarator(t.identifier(resultsVar), batchCall.argument),
					]),
					t.returnStatement(
						t.callExpression(t.memberExpression(t.identifier(resultsVar), t.identifier('every')), [
							t.arrowFunctionExpression(
								[t.identifier('r')],
								t.callExpression(t.identifier('Boolean'), [t.identifier('r')])
							),
						])
					),
				]),
				true
			),
			[]
		)
	);
}

/**
 * Wrap batch result if method needs post-processing
 */
export function wrapBatchResultIfNeeded(
	batchCall: t.AwaitExpression,
	methodName: string,
	array: t.Expression,
	methodId: string
): t.Expression {
	switch (methodName) {
		case 'filter':
			return wrapFilterResult(batchCall, array, methodId);
		case 'find':
			return wrapFindResult(batchCall, array, methodId);
		case 'some':
			return wrapSomeResult(batchCall, methodId);
		case 'every':
			return wrapEveryResult(batchCall, methodId);
		case 'forEach':
			return batchCall;
		default:
			return batchCall;
	}
}
