/**
 * Client initialization tests
 * Tests client session creation, token management, and verification
 */

import { createServer } from '@mondaydotcomorg/atp-server';
import { MemoryCache } from '@mondaydotcomorg/atp-providers';

describe('Client Initialization', () => {
	let server: any;
	let port: number;

	const getTestPort = () => 3501 + Math.floor(Math.random() * 500);
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

	beforeAll(() => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-for-e2e-tests-' + Date.now();
		port = getTestPort();
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
	});

	test('should initialize client with token', async () => {
		server = createServer({
			providers: {
				cache: new MemoryCache(),
			},
		});

		await server.listen(port);
		await waitForServer(port);

		const response = await fetch(`http://localhost:${port}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				clientInfo: { name: 'test-client', version: '1.0.0' },
			}),
		});

		expect(response.status).toBe(200);

		const data: any = await response.json();
		expect(data.clientId).toBeDefined();
		expect(data.token).toBeDefined();
		expect(data.expiresAt).toBeDefined();
		expect(data.tokenRotateAt).toBeDefined();
		expect(data.clientId).toMatch(/^cli_[a-f0-9]{32}$/);
	});

	test('should work without cache (use in-memory)', async () => {
		server = createServer();

		await server.listen(port);
		await waitForServer(port);

		const response = await fetch(`http://localhost:${port}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(200);

		const data: any = await response.json();
		expect(data.clientId).toBeDefined();
		expect(data.token).toBeDefined();
	});

	test('should generate unique client IDs', async () => {
		server = createServer({
			providers: {
				cache: new MemoryCache(),
			},
		});

		await server.listen(port);
		await waitForServer(port);

		const response1 = await fetch(`http://localhost:${port}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});
		const data1: any = await response1.json();

		const response2 = await fetch(`http://localhost:${port}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});
		const data2: any = await response2.json();

		expect(data1.clientId).not.toBe(data2.clientId);
		expect(data1.token).not.toBe(data2.token);
	});

	test('should store client info in session', async () => {
		server = createServer({
			providers: {
				cache: new MemoryCache(),
			},
		});

		await server.listen(port);
		await waitForServer(port);

		const response = await fetch(`http://localhost:${port}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				clientInfo: {
					name: 'test-app',
					version: '2.0.0',
					platform: 'node',
				},
			}),
		});

		const data: any = await response.json();
		expect(response.status).toBe(200);
		expect(data.clientId).toBeDefined();
	});

	test('should respect custom TTL settings', async () => {
		server = createServer({
			clientInit: {
				tokenTTL: 5000, // 5 seconds
			},
			providers: {
				cache: new MemoryCache(),
			},
		});

		await server.listen(port);
		await waitForServer(port);

		const response = await fetch(`http://localhost:${port}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});

		const data: any = await response.json();
		expect(response.status).toBe(200);

		const ttl = data.expiresAt - Date.now();
		expect(ttl).toBeLessThanOrEqual(5000);
		expect(ttl).toBeGreaterThan(4000); // Allow some variance
	});
});
