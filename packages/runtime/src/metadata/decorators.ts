/**
 * Decorator-based metadata system for runtime APIs
 *
 * These decorators are MARKERS ONLY - they don't extract types at runtime.
 * All type extraction happens at BUILD TIME using ts-morph.
 *

/**
 * Class decorator to mark a runtime API
 *
 * This is just a marker - ts-morph extracts all metadata at build time
 */
export function RuntimeAPI(name: string, description: string) {
	return function <T extends { new (...args: any[]): {} }>(constructor: T) {
		(constructor as any).API_NAME = name;
		(constructor as any).API_DESCRIPTION = description;

		return constructor;
	};
}

/**
 * Method decorator to mark a runtime method
 *
 * This is just a marker - ts-morph extracts types/params at build time
 * Only the description and optional param descriptions are stored
 */
export function RuntimeMethod(
	description: string,
	paramDescriptions?: Record<string, { description?: string; optional?: boolean; type?: string }>
) {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		if (!target.constructor.__methods) {
			target.constructor.__methods = {};
		}

		target.constructor.__methods[propertyKey] = {
			description,
			paramDescriptions: paramDescriptions || {},
		};

		return descriptor;
	};
}
