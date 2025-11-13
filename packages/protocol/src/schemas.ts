import type { JSONSchema } from './types.js';

export const ExecutionConfigSchema: JSONSchema = {
	type: 'object',
	properties: {
		timeout: { type: 'number', minimum: 1000, maximum: 300000 },
		maxMemory: { type: 'number', minimum: 1048576, maximum: 536870912 },
		maxLLMCalls: { type: 'number', minimum: 0, maximum: 100 },
		allowedAPIs: { type: 'array', items: { type: 'string' } },
		allowLLMCalls: { type: 'boolean' },
	},
	required: ['timeout', 'maxMemory', 'maxLLMCalls', 'allowedAPIs', 'allowLLMCalls'],
};

export const SearchOptionsSchema: JSONSchema = {
	type: 'object',
	properties: {
		query: { type: 'string', minLength: 1 },
		apiGroups: { type: 'array', items: { type: 'string' } },
		maxResults: { type: 'number', minimum: 1, maximum: 100 },
		useEmbeddings: { type: 'boolean' },
		embeddingModel: { type: 'string' },
	},
	required: ['query'],
};

export const AgentToolProtocolRequestSchema: JSONSchema = {
	type: 'object',
	properties: {
		jsonrpc: { type: 'string', enum: ['2.0'] },
		id: { type: ['string', 'number'] },
		method: { type: 'string' },
		params: { type: 'object' },
	},
	required: ['jsonrpc', 'id', 'method', 'params'],
};

export const AgentToolProtocolResponseSchema: JSONSchema = {
	type: 'object',
	properties: {
		jsonrpc: { type: 'string', enum: ['2.0'] },
		id: { type: ['string', 'number'] },
		result: {},
		error: {
			type: 'object',
			properties: {
				code: { type: 'number' },
				message: { type: 'string' },
				data: {},
			},
			required: ['code', 'message'],
		},
	},
	required: ['jsonrpc', 'id'],
};
