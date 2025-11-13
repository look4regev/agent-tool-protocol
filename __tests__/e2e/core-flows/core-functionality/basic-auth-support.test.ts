import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { ExecutionStatus, type AuthProvider } from '@mondaydotcomorg/atp-protocol';
import { loadOpenAPI } from '@mondaydotcomorg/atp-server';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import {
	createTestATPServer,
	createCleanupTracker,
	cleanupAll,
	getTestPort,
	type TestServer,
	type CleanupTracker,
} from '../../infrastructure/test-helpers';

describe('Bug Fix Validation: HTTP Basic Auth Support', () => {
	let atpServer: TestServer;
	let basicAuthMockServer: Server | null = null;
	let cleanup: CleanupTracker;
	let basicAuthPort: number;
	const tempFiles: string[] = [];

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-basic-auth';
		cleanup = createCleanupTracker();

		await new Promise((resolve) => setTimeout(resolve, 500));

		basicAuthPort = getTestPort();

		basicAuthMockServer = createServer((req: IncomingMessage, res: ServerResponse) => {
			const authHeader = req.headers.authorization;

			if (!authHeader || !authHeader.startsWith('Basic ')) {
				res.statusCode = 401;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({ error: 'Authentication required' }));
				return;
			}

			const credentials = Buffer.from(authHeader.substring(6), 'base64').toString('utf-8');
			const [username, password] = credentials.split(':');

			if (username !== 'testuser' || password !== 'testpass') {
				res.statusCode = 401;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({ error: 'Invalid credentials' }));
				return;
			}

			if (req.url === '/api/data' && req.method === 'GET') {
				res.statusCode = 200;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({ message: 'Success with Basic auth', authenticated: true }));
			} else {
				res.statusCode = 404;
				res.end(JSON.stringify({ error: 'Not found' }));
			}
		});

		await new Promise<void>((resolve, reject) => {
			basicAuthMockServer!.on('error', reject);
			basicAuthMockServer!.listen(basicAuthPort, () => resolve());
		});

		await new Promise((resolve) => setTimeout(resolve, 200));

		const basicAuthSpec = {
			openapi: '3.0.0',
			info: { title: 'Basic Auth Test API', version: '1.0.0' },
			servers: [{ url: `http://localhost:${basicAuthPort}` }],
			security: [{ basicAuth: [] }],
			components: {
				securitySchemes: {
					basicAuth: {
						type: 'http',
						scheme: 'basic',
					},
				},
			},
			paths: {
				'/api/data': {
					get: {
						operationId: 'getData',
						summary: 'Get data with Basic auth',
						responses: {
							'200': { description: 'Success' },
						},
					},
				},
			},
		};

		const basicAuthSpecPath = join(tmpdir(), `basic-auth-test-${Date.now()}.json`);
		writeFileSync(basicAuthSpecPath, JSON.stringify(basicAuthSpec));
		tempFiles.push(basicAuthSpecPath);

		process.env.BASIC_AUTH_TEST_API_USERNAME = 'testuser';
		process.env.BASIC_AUTH_TEST_API_PASSWORD = 'testpass';

		const basicAuthApiGroup = await loadOpenAPI(basicAuthSpecPath, {
			name: 'basicauth',
			baseURL: `http://localhost:${basicAuthPort}`,
		});

		atpServer = await createTestATPServer({
			apiGroups: [basicAuthApiGroup],
		});

		cleanup.servers.push(atpServer);
	});

	afterAll(async () => {
		if (basicAuthMockServer) {
			await new Promise<void>((resolve, reject) => {
				basicAuthMockServer!.close((err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		}

		await cleanupAll(cleanup);

		tempFiles.forEach((file) => {
			try {
				unlinkSync(file);
			} catch (e) {
				// Ignore
			}
		});

		delete process.env.BASIC_AUTH_TEST_API_USERNAME;
		delete process.env.BASIC_AUTH_TEST_API_PASSWORD;
	});

	it('should successfully authenticate with HTTP Basic auth', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'basic-auth-client' });

		const code = `
			const result = await api.basicauth.getData();
			return result;
		`;

		const result = await client.execute(code);

		if (result.status !== ExecutionStatus.COMPLETED) {
			console.log('Execution error:', JSON.stringify(result.error, null, 2));
		}

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.authenticated).toBe(true);
		expect(data.message).toContain('Basic auth');
	});

	it('should reject requests with invalid Basic auth credentials', async () => {
		process.env.BASIC_AUTH_TEST_API_USERNAME = 'wronguser';

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'basic-auth-invalid-client' });

		const code = `
			try {
				await api.basicauth.getData();
				return { authFailed: false };
			} catch (error) {
				return { authFailed: true, message: error.message };
			}
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.authFailed).toBe(true);
		expect(data.message).toContain('401');

		process.env.BASIC_AUTH_TEST_API_USERNAME = 'testuser';
	});

	it('should reject requests with missing Basic auth credentials', async () => {
		delete process.env.BASIC_AUTH_TEST_API_USERNAME;
		delete process.env.BASIC_AUTH_TEST_API_PASSWORD;

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'basic-auth-missing-client' });

		const code = `
			try {
				await api.basicauth.getData();
				return { authFailed: false };
			} catch (error) {
				return { authFailed: true, message: error.message };
			}
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.authFailed).toBe(true);

		process.env.BASIC_AUTH_TEST_API_USERNAME = 'testuser';
		process.env.BASIC_AUTH_TEST_API_PASSWORD = 'testpass';
	});
});
