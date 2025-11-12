import type { ValidationResult, ExecutionConfig } from '@agent-tool-protocol/protocol';
import { sanitizeInput, MAX_CODE_SIZE } from '@agent-tool-protocol/protocol';
import * as acorn from 'acorn';

interface ValidationError {
	line: number;
	message: string;
	severity: 'error' | 'warning';
}

interface SecurityIssue {
	line: number;
	issue: string;
	risk: 'low' | 'medium' | 'high';
}

/**
 * CodeValidator validates user code before execution using a whitelist approach.
 * Only explicitly allowed operations and patterns are permitted.
 */
export class CodeValidator {
	private readonly allowedGlobalObjects = new Set([
		'Array',
		'Object',
		'String',
		'Number',
		'Boolean',
		'Date',
		'Math',
		'JSON',
		'Promise',
		'Map',
		'Set',
		'WeakMap',
		'WeakSet',
		'Error',
		'TypeError',
		'RangeError',
		'console',
	]);

	private readonly forbiddenPatterns = [
		/\beval\s*\(/,
		/\bnew\s+Function\s*\(/,
		/\bnew\s+AsyncFunction\s*\(/,
		/\bnew\s+GeneratorFunction\s*\(/,
		/\brequire\s*\(/,
		/\bprocess\b/,
		/\bglobal\b/,
		/\bglobalThis\.process\b/,
		/\bglobalThis\.global\b/,
		/\b__dirname\b/,
		/\b__filename\b/,
		/\bmodule\b/,
		/\bexports\b/,
		/\bBuffer\b/,
		// Constructor chain exploits - CRITICAL security issue
		/constructor\s*\[\s*['"`]constructor['"`]\s*\]/,
		/constructor\.constructor/,
		/\['constructor'\]\s*\[\s*['"`]constructor['"`]\s*\]/,
		/\["constructor"\]\s*\[\s*['"`]constructor['"`]\s*\]/,
		/\[`constructor`\]\s*\[\s*['"`]constructor['"`]\s*\]/,
		// Prototype chain manipulation - sandbox escape vectors
		/__proto__/,
		/Object\.getPrototypeOf/,
		/Object\.setPrototypeOf/,
		/Reflect\.construct/,
		/Reflect\.get/,
		/Reflect\.set/,
		// Indirect eval patterns
		/\['eval'\]/,
		/\["eval"\]/,
		/\[`eval`\]/,
		/window\['eval'\]/,
		/this\['eval'\]/,
	];

	/**
	 * Validates code for security and syntax issues.
	 * @param code - The code to validate
	 * @param config - Execution configuration
	 * @returns Validation result with any errors or security issues
	 */
	async validate(code: string, config: ExecutionConfig): Promise<ValidationResult> {
		const errors: ValidationError[] = [];
		const warnings: ValidationError[] = [];
		const securityIssues: SecurityIssue[] = [];

		code = sanitizeInput(code, MAX_CODE_SIZE);

		for (const pattern of this.forbiddenPatterns) {
			if (pattern.test(code)) {
				securityIssues.push({
					line: 0,
					issue: `Forbidden pattern detected: ${pattern.source}`,
					risk: 'high',
				});
			}
		}

		this.checkGlobalAccess(code, securityIssues);

		this.validateImports(code, securityIssues);

		this.validateSyntax(code, errors);

		const hasHighRiskIssues = securityIssues.some((issue) => issue.risk === 'high');

		return {
			valid: errors.length === 0 && !hasHighRiskIssues,
			errors: errors.length > 0 ? errors : undefined,
			warnings: warnings.length > 0 ? warnings : undefined,
			securityIssues: securityIssues.length > 0 ? securityIssues : undefined,
		};
	}

	/**
	 * Validates JavaScript syntax using acorn parser.
	 * @param code - Code to validate
	 * @param errors - Array to append syntax errors to
	 */
	private validateSyntax(code: string, errors: ValidationError[]): void {
		try {
			acorn.parse(code, {
				ecmaVersion: 2022,
				sourceType: 'script',
				allowAwaitOutsideFunction: true,
				allowReturnOutsideFunction: true,
			});
		} catch (scriptError: any) {
			try {
				acorn.parse(code, {
					ecmaVersion: 2022,
					sourceType: 'module',
					allowAwaitOutsideFunction: true,
					allowReturnOutsideFunction: false,
				});
			} catch (moduleError: any) {
				errors.push({
					line: moduleError.loc?.line ?? 0,
					message: `Syntax error: ${moduleError.message}`,
					severity: 'error',
				});
			}
		}
	}

	/**
	 * Checks for unauthorized global object access.
	 * @param code - Code to check
	 * @param securityIssues - Array to append issues to
	 */
	private checkGlobalAccess(code: string, securityIssues: SecurityIssue[]): void {
		const globalAccessPattern = /\b([A-Z][a-zA-Z0-9]*)\./g;
		let match;

		while ((match = globalAccessPattern.exec(code)) !== null) {
			const globalName = match[1];
			if (
				globalName &&
				!this.allowedGlobalObjects.has(globalName) &&
				globalName !== 'atp' &&
				globalName !== 'api'
			) {
				securityIssues.push({
					line: 0,
					issue: `Unauthorized global access: ${globalName}`,
					risk: 'medium',
				});
			}
		}
	}

	/**
	 * Validates import statements to ensure NO imports are allowed.
	 * ALL imports are blocked for security - use injected sandbox globals instead.
	 * @param code - Code to validate
	 * @param securityIssues - Array to append issues to
	 */
	private validateImports(code: string, securityIssues: SecurityIssue[]): void {
		try {
			const ast = acorn.parse(code, {
				ecmaVersion: 2022,
				sourceType: 'module',
				allowAwaitOutsideFunction: true,
				allowReturnOutsideFunction: true,
			});

			const walk = (node: any) => {
				if (!node || typeof node !== 'object') return;

				if (node.type === 'ImportDeclaration') {
					const importSource = node.source?.value;
					securityIssues.push({
						line: node.loc?.start?.line ?? 0,
						issue: `All imports are blocked for security. Import attempted: ${importSource}. Use injected sandbox globals (api, atp) instead.`,
						risk: 'high',
					});
				}

				if (node.type === 'ImportExpression') {
					securityIssues.push({
						line: node.loc?.start?.line ?? 0,
						issue: `Dynamic import() is not allowed. All imports are blocked for security.`,
						risk: 'high',
					});
				}

				if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
					if (node.source?.value) {
						const exportSource = node.source.value;
						securityIssues.push({
							line: node.loc?.start?.line ?? 0,
							issue: `Re-exports are not allowed. Attempted re-export from: ${exportSource}.`,
							risk: 'high',
						});
					}
				}

				for (const key in node) {
					if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
					const child = node[key];
					if (Array.isArray(child)) {
						child.forEach(walk);
					} else if (child && typeof child === 'object') {
						walk(child);
					}
				}
			};

			walk(ast);
		} catch (error) {
			const importPattern = /^\s*import\s+.*?\s+from\s+['"](.+?)['"]/gm;
			let match;
			while ((match = importPattern.exec(code)) !== null) {
				const importSource = match[1];
				securityIssues.push({
					line: 0,
					issue: `All imports are blocked for security. Import detected: ${importSource}.`,
					risk: 'high',
				});
			}

			if (/import\s*\(/.test(code)) {
				securityIssues.push({
					line: 0,
					issue: `Dynamic import() is not allowed. All imports are blocked for security.`,
					risk: 'high',
				});
			}
		}
	}
}
