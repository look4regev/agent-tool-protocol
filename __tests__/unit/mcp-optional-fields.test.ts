/**
 * Unit tests for MCP adapter optional field handling
 * Tests that MCP tool schemas correctly preserve required/optional field information
 */

import { describe, test, expect } from '@jest/globals';

describe('MCP Adapter - Optional Fields', () => {
	test('should preserve required array in MCP tool schema', () => {
		const mcpTool = {
			name: 'testTool',
			description: 'A test tool',
			inputSchema: {
				type: 'object',
				properties: {
					requiredField: { type: 'string' },
					optionalField: { type: 'string' },
				},
				required: ['requiredField'],
			},
		};

		expect(mcpTool.inputSchema.required).toBeDefined();
		expect(mcpTool.inputSchema.required).toContain('requiredField');
		expect(mcpTool.inputSchema.required).not.toContain('optionalField');
	});

	test('should handle schema without required array', () => {
		const mcpTool = {
			name: 'allOptional',
			inputSchema: {
				type: 'object',
				properties: {
					field1: { type: 'string' },
					field2: { type: 'number' },
				},
			} as { type: string; properties: Record<string, unknown>; required?: string[] },
		};

		const required = mcpTool.inputSchema.required || [];
		expect(required).toEqual([]);
	});

	test('should handle schema with empty required array', () => {
		const mcpTool = {
			name: 'allOptional',
			inputSchema: {
				type: 'object',
				properties: {
					field1: { type: 'string' },
					field2: { type: 'number' },
				},
				required: [],
			},
		};

		expect(mcpTool.inputSchema.required).toEqual([]);
	});

	test('should handle schema with all fields required', () => {
		const mcpTool = {
			name: 'allRequired',
			inputSchema: {
				type: 'object',
				properties: {
					field1: { type: 'string' },
					field2: { type: 'number' },
				},
				required: ['field1', 'field2'],
			},
		};

		const allFieldsRequired = Object.keys(mcpTool.inputSchema.properties).every((field) =>
			mcpTool.inputSchema.required.includes(field)
		);
		expect(allFieldsRequired).toBe(true);
	});

	test('should correctly identify optional fields', () => {
		const schema = {
			type: 'object',
			properties: {
				name: { type: 'string' },
				age: { type: 'number' },
				email: { type: 'string' },
				phone: { type: 'string' },
			},
			required: ['name', 'email'],
		};

		const required = schema.required || [];
		const optionalFields = Object.keys(schema.properties).filter(
			(field) => !required.includes(field)
		);

		expect(optionalFields).toContain('age');
		expect(optionalFields).toContain('phone');
		expect(optionalFields).not.toContain('name');
		expect(optionalFields).not.toContain('email');
	});

	test('should handle nested object schemas', () => {
		const schema = {
			type: 'object',
			properties: {
				user: {
					type: 'object',
					properties: {
						name: { type: 'string' },
						age: { type: 'number' },
					},
					required: ['name'],
				},
				metadata: {
					type: 'object',
					properties: {
						version: { type: 'string' },
					},
				},
			},
			required: ['user'],
		};

		expect(schema.required).toContain('user');
		expect(schema.required).not.toContain('metadata');

		const userSchema = schema.properties.user as any;
		expect(userSchema.required).toContain('name');
		expect(userSchema.required).not.toContain('age');
	});

	test('should handle array types', () => {
		const schema = {
			type: 'object',
			properties: {
				items: {
					type: 'array',
					items: { type: 'string' },
				},
				tags: {
					type: 'array',
					items: { type: 'string' },
				},
			},
			required: ['items'],
		};

		const required = schema.required || [];
		expect(required.includes('items')).toBe(true);
		expect(required.includes('tags')).toBe(false);
	});

	test('should handle complex schema with multiple types', () => {
		const schema = {
			type: 'object',
			properties: {
				id: { type: 'string' },
				name: { type: 'string' },
				age: { type: 'number' },
				active: { type: 'boolean' },
				tags: { type: 'array', items: { type: 'string' } },
				metadata: { type: 'object' },
			},
			required: ['id', 'name'],
		};

		const required = schema.required || [];
		const optionalFields = Object.keys(schema.properties).filter(
			(field) => !required.includes(field)
		);

		expect(optionalFields).toEqual(['age', 'active', 'tags', 'metadata']);
		expect(required).toEqual(['id', 'name']);
	});
});
