/**
 * Metadata and Type Generation Utilities
 */

export type { RuntimeAPIParam, RuntimeAPIMethod, RuntimeAPIMetadata } from './types.js';
export { RuntimeAPI, RuntimeMethod } from './decorators.js';

import type { RuntimeAPIMetadata } from './types.js';

/**
 * Generates TypeScript definitions from runtime API metadata
 */
export function generateRuntimeTypes(apis: RuntimeAPIMetadata[]): string {
	let typescript = '// Runtime SDK\ndeclare const atp: {\n';

	for (const api of apis) {
		typescript += `  /**\n`;
		for (const line of api.description.split('\n')) {
			typescript += `   * ${line}\n`;
		}
		typescript += `   */\n`;

		typescript += `  ${api.name}: {\n`;

		for (const method of api.methods) {
			typescript += `    /**\n`;
			typescript += `     * ${method.description}\n`;

			for (const param of method.params) {
				if (param.description) {
					typescript += `     * @param ${param.name} - ${param.description}\n`;
				}
			}

			if (method.returns !== 'void') {
				const returnDesc = method.returns.startsWith('Promise')
					? 'Promise resolving to result'
					: 'Result value';
				typescript += `     * @returns ${returnDesc}\n`;
			}

			typescript += `     */\n`;

			const paramStrings = method.params.map((p) => {
				const optional = p.optional ? '?' : '';
				const type = p.type.includes('\n') ? p.type.replace(/\n/g, '\n      ') : p.type;
				return `${p.name}${optional}: ${type}`;
			});

			typescript += `    ${method.name}(${paramStrings.join(', ')}): ${method.returns};\n`;

			typescript += `\n`;
		}

		typescript += `  };\n\n`;
	}

	typescript += '};\n\n';

	return typescript;
}
