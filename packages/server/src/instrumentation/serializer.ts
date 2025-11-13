/**
 */
import type { SerializedValue } from './types.js';

/**
 * Configuration options for the Serializer
 */
export interface SerializerOptions {
	/**
	 * Additional global built-ins to skip during variable extraction
	 * (beyond the standard JavaScript built-ins that are detected automatically)
	 */
	customGlobalBuiltIns?: string[];

	/**
	 * Whether to use caching for keyword/built-in detection
	 * Default: true (recommended for performance)
	 */
	enableCaching?: boolean;
}

/**
 * Runtime-detected global built-ins (cached for performance)
 */
let cachedGlobals: Set<string> | null = null;

export class Serializer {
	private refCounter = 0;
	private refMap = new WeakMap<object, string>();
	private customGlobalBuiltIns: Set<string>;
	private keywordCache = new Map<string, boolean>();
	private globalCache: Set<string> | null = null;
	private enableCaching: boolean;

	constructor(options: SerializerOptions = {}) {
		this.customGlobalBuiltIns = new Set(options.customGlobalBuiltIns || []);
		this.enableCaching = options.enableCaching !== false;
	}

	/**
	 * Deep serialize a value with circular reference detection
	 */
	serialize(value: unknown, scope: Record<string, unknown> = {}): SerializedValue {
		const visited = new WeakSet();
		return this.deepSerialize(value, scope, visited);
	}

	/**
	 * Deserialize a value back to its original form
	 */
	deserialize(serialized: SerializedValue, refRegistry: Map<string, unknown> = new Map()): unknown {
		return this.deepDeserialize(serialized, refRegistry);
	}

	private deepSerialize(
		value: unknown,
		scope: Record<string, unknown>,
		visited: WeakSet<object>
	): SerializedValue {
		if (value === null || value === undefined) {
			return { type: 'primitive', value };
		}

		const type = typeof value;
		if (
			type === 'string' ||
			type === 'number' ||
			type === 'boolean' ||
			type === 'bigint' ||
			type === 'symbol'
		) {
			if (type === 'bigint') {
				return { type: 'primitive', value: value.toString() + 'n' };
			}
			if (type === 'symbol') {
				return { type: 'primitive', value: value.toString() };
			}
			return { type: 'primitive', value };
		}

		if (type === 'function') {
			return this.serializeFunction(value as Function, scope, visited);
		}

		if (type === 'object' && value !== null) {
			if (visited.has(value as object)) {
				let refId = this.refMap.get(value as object);
				if (!refId) {
					refId = `ref_${this.refCounter++}`;
					this.refMap.set(value as object, refId);
				}
				return { type: 'circular', refId };
			}

			visited.add(value as object);

			if (value instanceof Date) {
				return {
					type: 'date',
					value: value.toISOString(),
				};
			}

			if (value instanceof RegExp) {
				return {
					type: 'regexp',
					pattern: value.source,
					flags: value.flags,
				};
			}

			if (Array.isArray(value)) {
				return {
					type: 'array',
					value: value.map((item) => this.deepSerialize(item, scope, visited)),
				};
			}

			if (value instanceof Map) {
				const entries: Array<[SerializedValue, SerializedValue]> = [];
				for (const [k, v] of value.entries()) {
					entries.push([
						this.deepSerialize(k, scope, visited),
						this.deepSerialize(v, scope, visited),
					]);
				}
				return { type: 'map', entries };
			}

			if (value instanceof Set) {
				const items: SerializedValue[] = [];
				for (const item of value.values()) {
					items.push(this.deepSerialize(item, scope, visited));
				}
				return { type: 'set', items };
			}

			try {
				const properties: Record<string, SerializedValue> = {};
				for (const [k, v] of Object.entries(value as object)) {
					properties[k] = this.deepSerialize(v, scope, visited);
				}

				return {
					type: 'object',
					className: (value as any).constructor?.name,
					properties,
				};
			} catch (e) {
				return { type: 'nonserializable' };
			}
		}

		return { type: 'nonserializable' };
	}

	private serializeFunction(
		fn: Function,
		scope: Record<string, unknown>,
		visited: WeakSet<object>
	): SerializedValue {
		try {
			const source = fn.toString();

			if (source.includes('[native code]')) {
				return {
					type: 'function',
					source: 'native',
					className: fn.name,
				};
			}

			const referencedVars = this.extractReferencedVars(source);

			const closure: Record<string, SerializedValue> = {};
			for (const varName of referencedVars) {
				if (varName in scope) {
					closure[varName] = this.deepSerialize(scope[varName], scope, visited);
				}
			}

			return {
				type: 'function',
				source,
				closure,
				isAsync: source.startsWith('async'),
				isGenerator: fn.constructor.name === 'GeneratorFunction',
				isArrow: source.includes('=>'),
			};
		} catch (e) {
			return { type: 'nonserializable' };
		}
	}

	private extractReferencedVars(source: string): Set<string> {
		const vars = new Set<string>();

		const identifierRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
		let match;

		while ((match = identifierRegex.exec(source)) !== null) {
			const name = match[1];

			if (!name) continue;

			if (this.isReservedKeyword(name)) {
				continue;
			}

			if (this.isGlobalBuiltIn(name)) {
				continue;
			}

			vars.add(name);
		}

		return vars;
	}

	/**
	 * Check if a name is a reserved JavaScript keyword
	 * Uses caching for performance when enabled
	 */
	private isReservedKeyword(name: string): boolean {
		if (this.enableCaching && this.keywordCache.has(name)) {
			return this.keywordCache.get(name)!;
		}

		let isKeyword = false;
		try {
			new Function(`var ${name};`);
			isKeyword = false;
		} catch {
			isKeyword = true;
		}

		if (this.enableCaching) {
			this.keywordCache.set(name, isKeyword);
		}

		return isKeyword;
	}

	/**
	 * Check if a name is a global built-in
	 * Dynamically detects built-ins at runtime with caching for performance
	 */
	private isGlobalBuiltIn(name: string): boolean {
		if (this.customGlobalBuiltIns.has(name)) {
			return true;
		}

		if (this.enableCaching && !this.globalCache) {
			this.globalCache = this.detectGlobalBuiltIns();
		}

		if (this.enableCaching && this.globalCache) {
			return this.globalCache.has(name);
		}

		return this.isGlobalProperty(name);
	}

	/**
	 * Detect all global built-ins at runtime
	 * This is called once and cached for performance
	 */
	private detectGlobalBuiltIns(): Set<string> {
		const globals = new Set<string>();

		const globalObj = typeof globalThis !== 'undefined' ? globalThis : global;

		try {
			const ownProps = Object.getOwnPropertyNames(globalObj);
			for (const prop of ownProps) {
				globals.add(prop);
			}

			let proto = Object.getPrototypeOf(globalObj);
			while (proto) {
				const protoProps = Object.getOwnPropertyNames(proto);
				for (const prop of protoProps) {
					globals.add(prop);
				}
				proto = Object.getPrototypeOf(proto);
			}
		} catch (e) {
			const fallbackGlobals = [
				'undefined',
				'null',
				'true',
				'false',
				'Math',
				'Date',
				'Array',
				'Object',
				'String',
				'Number',
				'Boolean',
				'Promise',
				'Set',
				'Map',
				'WeakMap',
				'WeakSet',
				'JSON',
				'Error',
				'TypeError',
				'RegExp',
				'parseInt',
				'parseFloat',
				'isNaN',
				'isFinite',
				'console',
				'process',
				'Buffer',
				'global',
				'globalThis',
			];
			for (const g of fallbackGlobals) {
				globals.add(g);
			}
		}

		return globals;
	}

	/**
	 * Check if a name is a property of the global object
	 * Used when caching is disabled
	 */
	private isGlobalProperty(name: string): boolean {
		const globalObj = typeof globalThis !== 'undefined' ? globalThis : global;

		try {
			return name in globalObj;
		} catch {
			return false;
		}
	}

	private deepDeserialize(serialized: SerializedValue, refRegistry: Map<string, unknown>): unknown {
		switch (serialized.type) {
			case 'primitive':
				return serialized.value;

			case 'date':
				return new Date(serialized.value as string);

			case 'regexp':
				return new RegExp(serialized.pattern || '', serialized.flags || '');

			case 'array':
				return (serialized.value as SerializedValue[]).map((item) =>
					this.deepDeserialize(item, refRegistry)
				);

			case 'map': {
				const map = new Map();
				if (serialized.entries) {
					for (const [k, v] of serialized.entries) {
						map.set(this.deepDeserialize(k, refRegistry), this.deepDeserialize(v, refRegistry));
					}
				}
				return map;
			}

			case 'set': {
				const set = new Set();
				if (serialized.items) {
					for (const item of serialized.items) {
						set.add(this.deepDeserialize(item, refRegistry));
					}
				}
				return set;
			}

			case 'object': {
				const obj: Record<string, unknown> = {};
				if (serialized.properties) {
					for (const [k, v] of Object.entries(serialized.properties)) {
						obj[k] = this.deepDeserialize(v, refRegistry);
					}
				}
				return obj;
			}

			case 'function':
				return this.deserializeFunction(serialized, refRegistry);

			case 'circular':
				return refRegistry.get(serialized.refId!) || null;

			case 'nonserializable':
			default:
				return undefined;
		}
	}

	private deserializeFunction(
		serialized: SerializedValue,
		refRegistry: Map<string, unknown>
	): Function | undefined {
		try {
			if (serialized.source === 'native' || !serialized.source) {
				return undefined;
			}

			const closureNames = Object.keys(serialized.closure || {});
			const closureValues = closureNames.map((name) => {
				const closureValue = serialized.closure?.[name];
				return closureValue ? this.deepDeserialize(closureValue, refRegistry) : undefined;
			});

			const fnFactory = new Function(...closureNames, `return ${serialized.source}`);

			return fnFactory(...closureValues);
		} catch (e) {
			return undefined;
		}
	}
}
