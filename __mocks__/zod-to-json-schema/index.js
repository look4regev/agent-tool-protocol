// Mock zod-to-json-schema for Jest
module.exports = {
	zodToJsonSchema: (schema) => {
		// Simple mock that returns a basic JSON schema
		return {
			type: 'object',
			properties: {},
			required: [],
		};
	},
};
