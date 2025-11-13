/**
 * Converts a simple type map to a JSON Schema object
 */
export function toJSONSchema(types: Record<string, string>): {
	type: 'object';
	properties: Record<string, unknown>;
	required: string[];
} {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	for (const [key, type] of Object.entries(types)) {
		properties[key] = { type };
		required.push(key);
	}

	return { type: 'object', properties, required };
}
