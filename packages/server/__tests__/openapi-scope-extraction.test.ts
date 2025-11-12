import { describe, it, expect } from 'vitest';
import { OpenAPIConverter } from '../src/openapi';

describe('OpenAPI Scope Extraction', () => {
	describe('extractRequiredScopes', () => {
		it('should extract scopes from OpenAPI operation', () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test API', version: '1.0.0' },
				paths: {
					'/repos/{owner}/{repo}': {
						get: {
							operationId: 'getRepository',
							summary: 'Get a repository',
							security: [{ oauth2: ['repo', 'read:user'] }],
							parameters: [
								{ name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
								{ name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
							],
							responses: { '200': { description: 'Success' } },
						},
						delete: {
							operationId: 'deleteRepository',
							summary: 'Delete a repository',
							security: [{ oauth2: ['delete_repo'] }],
							parameters: [
								{ name: 'owner', in: 'path', required: true, schema: { type: 'string' } },
								{ name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
							],
							responses: { '204': { description: 'No Content' } },
						},
					},
				},
				components: {
					securitySchemes: {
						oauth2: {
							type: 'oauth2' as const,
							flows: {
								authorizationCode: {
									authorizationUrl: 'https://github.com/login/oauth/authorize',
									tokenUrl: 'https://github.com/login/oauth/access_token',
									scopes: {
										repo: 'Full control of private repositories',
										'read:user': 'Read user profile data',
										delete_repo: 'Delete repositories',
									},
								},
							},
						},
					},
				},
			};

			const apiGroup = OpenAPIConverter.fromSpec(spec);

			// Find the getRepository function
			const getRepoFunc = apiGroup.functions?.find((f) => f.name === 'getRepository');
			expect(getRepoFunc).toBeDefined();
			expect(getRepoFunc?.metadata?.requiredScopes).toEqual(['repo', 'read:user']);
			expect(getRepoFunc?.metadata?.operationType).toBe('read');

			// Find the deleteRepository function
			const deleteRepoFunc = apiGroup.functions?.find((f) => f.name === 'deleteRepository');
			expect(deleteRepoFunc).toBeDefined();
			expect(deleteRepoFunc?.metadata?.requiredScopes).toEqual(['delete_repo']);
			expect(deleteRepoFunc?.metadata?.operationType).toBe('destructive');
		});

		it('should use global security if operation has no security', () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test API', version: '1.0.0' },
				security: [{ oauth2: ['global:scope'] }],
				paths: {
					'/users': {
						get: {
							operationId: 'listUsers',
							summary: 'List users',
							responses: { '200': { description: 'Success' } },
						},
					},
				},
				components: {
					securitySchemes: {
						oauth2: {
							type: 'oauth2' as const,
							flows: {
								clientCredentials: {
									tokenUrl: 'https://api.example.com/oauth/token',
									scopes: { 'global:scope': 'Global access' },
								},
							},
						},
					},
				},
			};

			const apiGroup = OpenAPIConverter.fromSpec(spec);
			const listUsersFunc = apiGroup.functions?.find((f) => f.name === 'listUsers');

			expect(listUsersFunc?.metadata?.requiredScopes).toEqual(['global:scope']);
		});

		it('should infer operation type from HTTP method', () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test API', version: '1.0.0' },
				paths: {
					'/items': {
						get: {
							operationId: 'listItems',
							responses: { '200': { description: 'Success' } },
						},
						post: {
							operationId: 'createItem',
							responses: { '201': { description: 'Created' } },
						},
						put: {
							operationId: 'updateItem',
							responses: { '200': { description: 'Success' } },
						},
						delete: {
							operationId: 'deleteItem',
							responses: { '204': { description: 'No Content' } },
						},
					},
				},
			};

			const apiGroup = OpenAPIConverter.fromSpec(spec);

			const listItems = apiGroup.functions?.find((f) => f.name === 'listItems');
			expect(listItems?.metadata?.operationType).toBe('read');

			const createItem = apiGroup.functions?.find((f) => f.name === 'createItem');
			expect(createItem?.metadata?.operationType).toBe('write');

			const updateItem = apiGroup.functions?.find((f) => f.name === 'updateItem');
			expect(updateItem?.metadata?.operationType).toBe('write');

			const deleteItem = apiGroup.functions?.find((f) => f.name === 'deleteItem');
			expect(deleteItem?.metadata?.operationType).toBe('destructive');
		});

		it('should handle operations without security requirements', () => {
			const spec = {
				openapi: '3.0.0',
				info: { title: 'Test API', version: '1.0.0' },
				paths: {
					'/public': {
						get: {
							operationId: 'getPublicData',
							responses: { '200': { description: 'Success' } },
						},
					},
				},
			};

			const apiGroup = OpenAPIConverter.fromSpec(spec);
			const publicFunc = apiGroup.functions?.find((f) => f.name === 'getPublicData');

			expect(publicFunc?.metadata?.requiredScopes).toBeUndefined();
			expect(publicFunc?.metadata?.operationType).toBe('read');
		});
	});
});
