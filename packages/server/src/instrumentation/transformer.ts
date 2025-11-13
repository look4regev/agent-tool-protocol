/**
 * Code Instrumentation Engine
 */
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import type { InstrumentedCode, InstrumentationMetadata } from './types.js';

export class CodeInstrumentor {
	private statementId = 0;

	/**
	 * Instrument code with state capture calls
	 */
	instrument(code: string): InstrumentedCode {
		this.statementId = 0;

		const ast = parse(code, {
			sourceType: 'module',
			plugins: ['typescript'],
			allowAwaitOutsideFunction: true,
			allowReturnOutsideFunction: true,
		});

		const metadata: InstrumentationMetadata = {
			statements: [],
			variables: new Set(),
			functions: [],
		};

		traverse(ast, {
			VariableDeclaration: (path) => {
				path.node.declarations.forEach((decl) => {
					if (t.isIdentifier(decl.id)) {
						metadata.variables.add(decl.id.name);
					}
				});
			},

			FunctionDeclaration: (path) => {
				if (path.node.id) {
					metadata.functions.push({
						name: path.node.id.name,
						line: path.node.loc?.start.line,
					});
				}
			},

			Statement: (path) => {
				if (
					t.isFunctionDeclaration(path.node) ||
					t.isClassDeclaration(path.node) ||
					t.isImportDeclaration(path.node) ||
					t.isExportDeclaration(path.node) ||
					path.node.type.includes('Export')
				) {
					return;
				}

				if (t.isBlockStatement(path.parent) && path.key !== 'body') {
					return;
				}

				const id = this.statementId++;

				metadata.statements.push({
					id,
					line: path.node.loc?.start.line,
					type: path.node.type,
				});
			},
		});

		const result = generate(ast, {
			sourceMaps: false,
		});

		return {
			code: result.code,
			metadata,
		};
	}
}
