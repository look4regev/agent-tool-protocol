/**
 * Unit tests for APIAggregator TypeScript generation with optional fields
 * Tests that TypeScript definitions correctly mark optional fields with ?
 */

import { describe, test, expect } from '@jest/globals';
import { APIAggregator } from '../../packages/server/src/aggregator/index';
import type { APIGroupConfig } from '@mondaydotcomorg/atp-protocol';

describe('APIAggregator - Optional Field Generation', () => {
	test('should generate TypeScript with optional field markers', async () => {
		const apiGroup: APIGroupConfig = {
			name: 'testAPI',
			type: 'custom',
			functions: [
				{
					name: 'testFunction',
					description: 'Test function with mixed fields',
					inputSchema: {
						type: 'object',
						properties: {
							requiredField: { type: 'string', description: 'Required' },
							optionalField: { type: 'string', description: 'Optional' },
						},
						required: ['requiredField'],
					},
					handler: async () => ({}),
				},
			],
		};

		const aggregator = new APIAggregator([apiGroup]);
		const typescript = await aggregator.generateTypeScript();

		// Required field should NOT have ?
		expect(typescript).toMatch(/requiredField: string/);
		expect(typescript).not.toMatch(/requiredField\?: string/);

		// Optional field SHOULD have ?
		expect(typescript).toMatch(/optionalField\?: string/);
	});

	test('should handle all optional fields (no required array)', async () => {
		const apiGroup: APIGroupConfig = {
			name: 'testAPI',
			type: 'custom',
			functions: [
				{
					name: 'allOptional',
					description: 'All fields optional',
					inputSchema: {
						type: 'object',
						properties: {
							field1: { type: 'string' },
							field2: { type: 'number' },
						},
						// No required array
					},
					handler: async () => ({}),
				},
			],
		};

		const aggregator = new APIAggregator([apiGroup]);
		const typescript = await aggregator.generateTypeScript();

		// All fields should have ?
		expect(typescript).toMatch(/field1\?: string/);
		expect(typescript).toMatch(/field2\?: number/);
	});

	test('should handle all required fields', async () => {
		const apiGroup: APIGroupConfig = {
			name: 'testAPI',
			type: 'custom',
			functions: [
				{
					name: 'allRequired',
					description: 'All fields required',
					inputSchema: {
						type: 'object',
						properties: {
							field1: { type: 'string' },
							field2: { type: 'number' },
						},
						required: ['field1', 'field2'],
					},
					handler: async () => ({}),
				},
			],
		};

		const aggregator = new APIAggregator([apiGroup]);
		const typescript = await aggregator.generateTypeScript();

		// No fields should have ?
		expect(typescript).toMatch(/field1: string/);
		expect(typescript).not.toMatch(/field1\?: string/);
		expect(typescript).toMatch(/field2: number/);
		expect(typescript).not.toMatch(/field2\?: number/);
	});

	test('should handle empty required array (all optional)', async () => {
		const apiGroup: APIGroupConfig = {
			name: 'testAPI',
			type: 'custom',
			functions: [
				{
					name: 'emptyRequired',
					description: 'Empty required array',
					inputSchema: {
						type: 'object',
						properties: {
							field1: { type: 'string' },
							field2: { type: 'number' },
						},
						required: [],
					},
					handler: async () => ({}),
				},
			],
		};

		const aggregator = new APIAggregator([apiGroup]);
		const typescript = await aggregator.generateTypeScript();

		// All fields should have ?
		expect(typescript).toMatch(/field1\?: string/);
		expect(typescript).toMatch(/field2\?: number/);
	});

	test('should handle multiple functions with different required fields', async () => {
		const apiGroup: APIGroupConfig = {
			name: 'testAPI',
			type: 'custom',
			functions: [
				{
					name: 'func1',
					description: 'Function 1',
					inputSchema: {
						type: 'object',
						properties: {
							a: { type: 'string' },
							b: { type: 'string' },
						},
						required: ['a'],
					},
					handler: async () => ({}),
				},
				{
					name: 'func2',
					description: 'Function 2',
					inputSchema: {
						type: 'object',
						properties: {
							x: { type: 'number' },
							y: { type: 'number' },
						},
						required: ['x', 'y'],
					},
					handler: async () => ({}),
				},
			],
		};

		const aggregator = new APIAggregator([apiGroup]);
		const typescript = await aggregator.generateTypeScript();

		// func1: a required, b optional
		expect(typescript).toMatch(/interface func1_Input[\s\S]*a: string/);
		expect(typescript).toMatch(/interface func1_Input[\s\S]*b\?: string/);

		// func2: both required
		expect(typescript).toMatch(/interface func2_Input[\s\S]*x: number/);
		expect(typescript).toMatch(/interface func2_Input[\s\S]*y: number/);
		expect(typescript).not.toMatch(/interface func2_Input[\s\S]*x\?: number/);
	});

	test('should handle different property types correctly', async () => {
		const apiGroup: APIGroupConfig = {
			name: 'testAPI',
			type: 'custom',
			functions: [
				{
					name: 'mixedTypes',
					description: 'Function with mixed types',
					inputSchema: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							age: { type: 'number' },
							active: { type: 'boolean' },
							tags: { type: 'array' },
							meta: { type: 'object' },
						},
						required: ['name', 'active'],
					},
					handler: async () => ({}),
				},
			],
		};

		const aggregator = new APIAggregator([apiGroup]);
		const typescript = await aggregator.generateTypeScript();

		// Required fields
		expect(typescript).toMatch(/name: string/);
		expect(typescript).not.toMatch(/name\?: string/);
		expect(typescript).toMatch(/active: boolean/);
		expect(typescript).not.toMatch(/active\?: boolean/);

		// Optional fields
		expect(typescript).toMatch(/age\?: number/);
		expect(typescript).toMatch(/tags\?: unknown\[\]/);
		expect(typescript).toMatch(/meta\?: Record<string, unknown>/);
	});

	test('should preserve comments with optional fields', async () => {
		const apiGroup: APIGroupConfig = {
			name: 'testAPI',
			type: 'custom',
			functions: [
				{
					name: 'documented',
					description: 'Function with documentation',
					inputSchema: {
						type: 'object',
						properties: {
							required: { type: 'string', description: 'This is required' },
							optional: { type: 'string', description: 'This is optional' },
						},
						required: ['required'],
					},
					handler: async () => ({}),
				},
			],
		};

		const aggregator = new APIAggregator([apiGroup]);
		const typescript = await aggregator.generateTypeScript();

		// Should have comments with correct optional markers
		expect(typescript).toMatch(/required: string.*This is required/);
		expect(typescript).toMatch(/optional\?: string.*This is optional/);
	});

	test('should handle MCP-sourced tools correctly', async () => {
		const mcpApiGroup: APIGroupConfig = {
			name: 'mcpTools',
			type: 'mcp',
			functions: [
				{
					name: 'mcpTool',
					description: 'Tool from MCP server',
					inputSchema: {
						type: 'object',
						properties: {
							query: { type: 'string', description: 'Search query' },
							limit: { type: 'number', description: 'Result limit' },
							offset: { type: 'number', description: 'Result offset' },
						},
						required: ['query'],
					},
					handler: async () => ({}),
				},
			],
		};

		const aggregator = new APIAggregator([mcpApiGroup]);
		const typescript = await aggregator.generateTypeScript();

		// query is required
		expect(typescript).toMatch(/query: string/);
		expect(typescript).not.toMatch(/query\?: string/);

		// limit and offset are optional
		expect(typescript).toMatch(/limit\?: number/);
		expect(typescript).toMatch(/offset\?: number/);
	});

	test('should generate valid TypeScript interface syntax', async () => {
		const apiGroup: APIGroupConfig = {
			name: 'testAPI',
			type: 'custom',
			functions: [
				{
					name: 'validSyntax',
					description: 'Function with valid syntax',
					inputSchema: {
						type: 'object',
						properties: {
							a: { type: 'string' },
							b: { type: 'number' },
							c: { type: 'boolean' },
						},
						required: ['a'],
					},
					handler: async () => ({}),
				},
			],
		};

		const aggregator = new APIAggregator([apiGroup]);
		const typescript = await aggregator.generateTypeScript();

		// Should have proper interface structure
		expect(typescript).toMatch(/interface validSyntax_Input \{/);
		expect(typescript).toMatch(/\}/);

		// Should have valid property syntax
		expect(typescript).toMatch(/a: string;/);
		expect(typescript).toMatch(/b\?: number;/);
		expect(typescript).toMatch(/c\?: boolean;/);
	});
});
