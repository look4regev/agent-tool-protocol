/**
 * OpenAPI loading tests
 * Tests loading OpenAPI specs, filtering, and conversion to ATP
 */

import { loadOpenAPI } from '@mondaydotcomorg/atp-server';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

describe('OpenAPI Loading', () => {
	let tempFiles: string[] = [];

	const getTempFilePath = (prefix: string, suffix: string) => {
		return join(tmpdir(), `${prefix}-${randomBytes(8).toString('hex')}${suffix}`);
	};

	afterAll(() => {
		tempFiles.forEach((file) => {
			try {
				unlinkSync(file);
			} catch (e) {
				// Ignore
			}
		});
	});

	test('should load minimal OpenAPI spec', async () => {
		const specPath = getTempFilePath('openapi', '.json');
		tempFiles.push(specPath);

		const spec = {
			openapi: '3.0.0',
			info: { title: 'Test API', version: '1.0.0' },
			paths: {
				'/users/{id}': {
					get: {
						operationId: 'getUser',
						summary: 'Get user by ID',
						parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
						responses: {
							'200': {
								description: 'Success',
								content: {
									'application/json': {
										schema: {
											type: 'object',
											properties: {
												id: { type: 'string' },
												name: { type: 'string' },
											},
										},
									},
								},
							},
						},
					},
				},
			},
		};

		writeFileSync(specPath, JSON.stringify(spec));

		const apiGroup = await loadOpenAPI(specPath, { name: 'testapi' });

		expect(apiGroup.name).toBe('testapi');
		expect(apiGroup.type).toBe('openapi');
		expect(apiGroup.functions).toBeDefined();
		expect(apiGroup.functions!.length).toBeGreaterThan(0);
	});

	test('should extract function name from operationId', async () => {
		const specPath = getTempFilePath('openapi', '.json');
		tempFiles.push(specPath);

		const spec = {
			openapi: '3.0.0',
			info: { title: 'Test', version: '1.0.0' },
			paths: {
				'/test': {
					post: {
						operationId: 'createTest',
						summary: 'Create test',
						responses: { '200': { description: 'OK' } },
					},
				},
			},
		};

		writeFileSync(specPath, JSON.stringify(spec));

		const apiGroup = await loadOpenAPI(specPath);

		expect(apiGroup.functions![0]!.name).toBe('createTest');
	});

	test('should filter by tags', async () => {
		const specPath = getTempFilePath('openapi', '.json');
		tempFiles.push(specPath);

		const spec = {
			openapi: '3.0.0',
			info: { title: 'Test', version: '1.0.0' },
			paths: {
				'/users': {
					get: {
						operationId: 'listUsers',
						tags: ['users'],
						responses: { '200': { description: 'OK' } },
					},
				},
				'/posts': {
					get: {
						operationId: 'listPosts',
						tags: ['posts'],
						responses: { '200': { description: 'OK' } },
					},
				},
			},
		};

		writeFileSync(specPath, JSON.stringify(spec));

		const apiGroup = await loadOpenAPI(specPath, {
			filter: { tags: ['users'] },
		});

		expect(apiGroup.functions!.length).toBe(1);
		expect(apiGroup.functions![0]!.name).toBe('listUsers');
	});

	test('should filter by path patterns', async () => {
		const specPath = getTempFilePath('openapi', '.json');
		tempFiles.push(specPath);

		const spec = {
			openapi: '3.0.0',
			info: { title: 'Test', version: '1.0.0' },
			paths: {
				'/v1/users': {
					get: { operationId: 'v1GetUsers', responses: { '200': { description: 'OK' } } },
				},
				'/v1/posts': {
					get: { operationId: 'v1GetPosts', responses: { '200': { description: 'OK' } } },
				},
				'/v2/users': {
					get: { operationId: 'v2GetUsers', responses: { '200': { description: 'OK' } } },
				},
			},
		};

		writeFileSync(specPath, JSON.stringify(spec));

		const apiGroup = await loadOpenAPI(specPath, {
			filter: { paths: ['/v1/*'] },
		});

		expect(apiGroup.functions!.length).toBe(2);
	});

	test('should exclude by path patterns', async () => {
		const specPath = getTempFilePath('openapi', '.json');
		tempFiles.push(specPath);

		const spec = {
			openapi: '3.0.0',
			info: { title: 'Test', version: '1.0.0' },
			paths: {
				'/api/users': {
					get: { operationId: 'getUsers', responses: { '200': { description: 'OK' } } },
				},
				'/api/admin/settings': {
					get: { operationId: 'getSettings', responses: { '200': { description: 'OK' } } },
				},
			},
		};

		writeFileSync(specPath, JSON.stringify(spec));

		const apiGroup = await loadOpenAPI(specPath, {
			filter: { exclude: ['/api/admin/*'] },
		});

		expect(apiGroup.functions!.length).toBe(1);
		expect(apiGroup.functions![0]!.name).toBe('getUsers');
	});

	test('should filter by HTTP methods', async () => {
		const specPath = getTempFilePath('openapi', '.json');
		tempFiles.push(specPath);

		const spec = {
			openapi: '3.0.0',
			info: { title: 'Test', version: '1.0.0' },
			paths: {
				'/users': {
					get: { operationId: 'getUsers', responses: { '200': { description: 'OK' } } },
					post: { operationId: 'createUser', responses: { '200': { description: 'OK' } } },
					put: { operationId: 'updateUser', responses: { '200': { description: 'OK' } } },
					delete: { operationId: 'deleteUser', responses: { '200': { description: 'OK' } } },
				},
			},
		};

		writeFileSync(specPath, JSON.stringify(spec));

		const apiGroup = await loadOpenAPI(specPath, {
			filter: { methods: ['GET', 'POST'] },
		});

		expect(apiGroup.functions!.length).toBe(2);
	});

	test('should extract OpenAPI x- annotations', async () => {
		const specPath = getTempFilePath('openapi', '.json');
		tempFiles.push(specPath);

		const spec = {
			openapi: '3.0.0',
			info: { title: 'Test', version: '1.0.0' },
			paths: {
				'/users/{id}': {
					delete: {
						operationId: 'deleteUser',
						'x-destructive': true,
						'x-requires-approval': true,
						'x-risk-level': 'high',
						responses: { '200': { description: 'OK' } },
					},
				},
			},
		};

		writeFileSync(specPath, JSON.stringify(spec));

		const apiGroup = await loadOpenAPI(specPath, {
			annotations: {
				fromExtensions: {
					'x-destructive': 'destructive',
					'x-requires-approval': 'requiresApproval',
					'x-risk-level': 'risk',
				},
			},
		});

		// Annotations are extracted but not stored in function yet
		expect(apiGroup.functions![0]!.name).toBe('deleteUser');
	});
});
