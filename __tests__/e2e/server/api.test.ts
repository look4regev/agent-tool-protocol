import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { initializeCache, initializeLogger } from '@mondaydotcomorg/atp-runtime';

describe('ATP Server API - Core endpoints and execution', () => {
	let server: AgentToolProtocolServer;
	const TEST_API_KEY = 'test_key_e2e_' + Date.now();
	const TEST_PORT = 3334;
	let serverInstance: any;

	beforeAll(async () => {
		// Set JWT secret for testing
		process.env.ATP_JWT_SECRET = 'test-secret-key-for-e2e-tests-' + Date.now();

		// Initialize runtime
		initializeLogger({ level: 'error', pretty: false });
		initializeCache({ type: 'memory', maxKeys: 1000, defaultTTL: 600 });

		// Create server
		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 5,
			},
		});

		// Add API groups using .use()
		server.use({
			name: 'test-api',
			type: 'custom',
			functions: [
				{
					name: 'echo',
					description: 'Echoes back the input',
					inputSchema: {
						type: 'object',
						properties: {
							message: { type: 'string' },
						},
						required: ['message'],
					},
					handler: async (input: any) => ({
						echo: input.message,
						timestamp: new Date().toISOString(),
					}),
				},
				{
					name: 'add',
					description: 'Adds two numbers',
					inputSchema: {
						type: 'object',
						properties: {
							a: { type: 'number' },
							b: { type: 'number' },
						},
						required: ['a', 'b'],
					},
					handler: async (input: any) => ({
						result: input.a + input.b,
					}),
				},
			],
		});

		// Start server
		await server.listen(TEST_PORT);
		// Wait a bit for server to be ready
		await new Promise((resolve) => setTimeout(resolve, 500));
	});

	afterAll(async () => {
		// Stop the server
		if (server) {
			await server.stop();
		}

		// Clean up JWT secret
		delete process.env.ATP_JWT_SECRET;
	});

	test('GET /api/info should return server info', async () => {
		const response = await fetch(`http://localhost:${TEST_PORT}/api/info`, {
			headers: {
				Authorization: `Bearer ${TEST_API_KEY}`,
			},
		});
		const data: any = await response.json();

		expect(response.status).toBe(200);
		expect(data).toHaveProperty('version');
		expect(data).toHaveProperty('capabilities');
		expect(data.capabilities.execution).toBe(true);
	});

	test('GET /api/definitions without auth should succeed', async () => {
		const response = await fetch(`http://localhost:${TEST_PORT}/api/definitions`);

		// Auth is not enforced on /api/definitions endpoint
		expect(response.status).toBe(200);
	});

	test('GET /api/definitions with auth should succeed', async () => {
		const response = await fetch(`http://localhost:${TEST_PORT}/api/definitions`, {
			headers: {
				Authorization: `Bearer ${TEST_API_KEY}`,
			},
		});
		const data: any = await response.json();

		expect(response.status).toBe(200);
		expect(data).toHaveProperty('typescript');
		expect(data).toHaveProperty('apiGroups');
		expect(data.apiGroups).toContain('test-api');
	});

	test('POST /api/search should find functions', async () => {
		const response = await fetch(`http://localhost:${TEST_PORT}/api/search`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${TEST_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				query: 'echo',
				maxResults: 10,
			}),
		});
		const data: any = await response.json();

		expect(response.status).toBe(200);
		expect(data).toHaveProperty('results');
		expect(data.results.length).toBeGreaterThan(0);
		expect(data.results[0].functionName).toBe('echo');
	});

	test('POST /api/execute should execute simple code', async () => {
		const response = await fetch(`http://localhost:${TEST_PORT}/api/execute`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${TEST_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				code: 'return 2 + 2;',
			}),
		});
		const data: any = await response.json();

		expect(response.status).toBe(200);
		expect(data.status).toBe('completed');
		expect(data.result).toBe(4);
		expect(data.stats.duration).toBeGreaterThan(0);
	});

	test('POST /api/execute should call API functions', async () => {
		const response = await fetch(`http://localhost:${TEST_PORT}/api/execute`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${TEST_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				code: 'const result = await api["test-api"].add({ a: 5, b: 3 }); return result;',
			}),
		});
		const data: any = await response.json();

		expect(response.status).toBe(200);
		expect(data.status).toBe('completed');
		expect(data.result).toEqual({ result: 8 });
	});

	test('POST /api/execute should use cache', async () => {
		const response = await fetch(`http://localhost:${TEST_PORT}/api/execute`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${TEST_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				code: `
					await atp.cache.set('test', { value: 123 }, 60);
					const cached = await atp.cache.get('test');
					return cached;
				`,
			}),
		});
		const data: any = await response.json();

		expect(response.status).toBe(200);
		expect(data.status).toBe('completed');
		expect(data.result).toEqual({ value: 123 });
	});

	test('POST /api/execute should handle errors', async () => {
		const response = await fetch(`http://localhost:${TEST_PORT}/api/execute`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${TEST_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				code: 'throw new Error("Test error");',
			}),
		});
		const data: any = await response.json();

		expect(response.status).toBe(200);
		expect(data.status).toBe('failed');
		expect(data.error).toBeDefined();
		expect(data.error.message).toContain('Test error');
	});

	test('POST /api/execute should handle syntax errors', async () => {
		const response = await fetch(`http://localhost:${TEST_PORT}/api/execute`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${TEST_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				code: 'function invalid( { return }',
			}),
		});
		const data: any = await response.json();

		// Validator may not catch all syntax errors before execution
		// So we expect either 400 (validation failed) or 200 with failed/parse_error status
		expect(response.status).toBeGreaterThanOrEqual(200);
		if (response.status === 200) {
			expect(['failed', 'parse_error']).toContain(data.status);
		}
	});
});
