/**
 * Core server functionality tests
 * Tests basic server creation, configuration, and HTTP endpoints
 */

import { createServer } from '@agent-tool-protocol/server';
import { MemoryCache, EnvAuthProvider, JSONLAuditSink } from '@agent-tool-protocol/providers';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';

describe('Core Server Basics', () => {
	let server: any;
	let tempFiles: string[] = [];

	const getTestPort = () => 3500 + Math.floor(Math.random() * 500);
	const waitForServer = async (port: number, maxAttempts = 10) => {
		for (let i = 0; i < maxAttempts; i++) {
			try {
				await fetch(`http://localhost:${port}/api/info`);
				return;
			} catch (e) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
	};

	const getTempFilePath = (prefix: string, suffix: string) => {
		return join(tmpdir(), `${prefix}-${randomBytes(8).toString('hex')}${suffix}`);
	};

	beforeAll(() => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-for-e2e-tests-' + Date.now();
	});

	afterEach(async () => {
		if (server) {
			try {
				await server.stop();
			} catch (error) {
				// Ignore if already stopped
			}
			server = null;
		}
	});

	afterAll(() => {
		delete process.env.ATP_JWT_SECRET;
		tempFiles.forEach((file) => {
			try {
				unlinkSync(file);
			} catch (e) {
				// Ignore
			}
		});
	});

	test('should create server with minimal config', () => {
		server = createServer();
		expect(server).toBeDefined();
	});

	test('should create server with custom config', () => {
		server = createServer({
			execution: {
				timeout: 5000,
				memory: 64 * 1024 * 1024,
				llmCalls: 5,
			},
			discovery: {
				embeddings: false,
			},
		});
		expect(server).toBeDefined();
	});

	test('should inject cache provider via config', () => {
		const cache = new MemoryCache();
		server = createServer({
			providers: {
				cache,
			},
		});
		expect(server).toBeDefined();
		expect(server.cacheProvider).toBe(cache);
	});

	test('should inject auth provider via config', () => {
		const auth = new EnvAuthProvider();
		server = createServer({
			providers: {
				auth,
			},
		});
		expect(server).toBeDefined();
		expect(server.authProvider).toBe(auth);
	});

	test('should inject audit sink via config', () => {
		const auditFile = getTempFilePath('audit', '.jsonl');
		tempFiles.push(auditFile);
		const audit = new JSONLAuditSink({ filePath: auditFile });
		server = createServer({
			audit: {
				enabled: true,
				sinks: audit,
			},
		});
		expect(server).toBeDefined();
		expect(server.auditSink).toBe(audit);
	});

	test('should start and stop server', async () => {
		const port = getTestPort();
		server = createServer();
		await server.listen(port);
		await waitForServer(port);
		await server.stop();
	});

	test('should respond to /api/info endpoint', async () => {
		const port = getTestPort();
		server = createServer({
			execution: {
				timeout: 10000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
			},
		});
		await server.listen(port);
		await waitForServer(port);

		const response = await fetch(`http://localhost:${port}/api/info`);
		expect(response.status).toBe(200);

		const data: any = await response.json();
		expect(data.version).toBeDefined();
		expect(data.capabilities).toBeDefined();
		expect(data.limits).toBeDefined();
		expect(data.limits.maxTimeout).toBe(10000);
	});

	test('should respond to /api/definitions endpoint', async () => {
		const port = getTestPort();
		server = createServer();
		await server.listen(port);
		await waitForServer(port);

		const response = await fetch(`http://localhost:${port}/api/definitions`);
		expect(response.status).toBe(200);

		const data: any = await response.json();
		expect(data.typescript).toBeDefined();
		expect(data.apiGroups).toBeDefined();
		expect(Array.isArray(data.apiGroups)).toBeTruthy();
	});

	test('should return 404 for unknown routes', async () => {
		const port = getTestPort();
		server = createServer();
		await server.listen(port);
		await waitForServer(port);

		const response = await fetch(`http://localhost:${port}/api/unknown`);
		expect(response.status).toBe(404);
	});

	test('should inject all providers via config', async () => {
		const port = getTestPort();
		const cache = new MemoryCache();
		const auth = new EnvAuthProvider();
		const auditFile = getTempFilePath('audit', '.jsonl');
		tempFiles.push(auditFile);
		const audit = new JSONLAuditSink({ filePath: auditFile });

		server = createServer({
			providers: {
				cache,
				auth,
			},
			audit: {
				enabled: true,
				sinks: audit,
			},
		});

		await server.listen(port);
		await waitForServer(port);

		const response = await fetch(`http://localhost:${port}/api/info`);
		expect(response.status).toBe(200);
	});
});
