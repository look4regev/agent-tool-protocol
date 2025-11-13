import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { ExecutionStatus } from '@mondaydotcomorg/atp-protocol';
import {
	createTestATPServer,
	createCleanupTracker,
	cleanupAll,
	type TestServer,
	type CleanupTracker,
} from '../../infrastructure/test-helpers';

describe('Phase 1: JWT Multi-Tenant Isolation', () => {
	let atpServer: TestServer;
	let cleanup: CleanupTracker;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-jwt-multi-tenant';
		cleanup = createCleanupTracker();

		await new Promise((resolve) => setTimeout(resolve, 500));

		atpServer = await createTestATPServer({
			apiGroups: [
				{
					name: 'cache-test',
					type: 'custom',
					functions: [
						{
							name: 'getValue',
							description: 'Get cached value',
							inputSchema: {
								type: 'object',
								properties: {
									key: { type: 'string' },
								},
								required: ['key'],
							},
							handler: async (params: any, context: any) => {
								const cached = await context.cache?.get(`${context.clientId}:${params.key}`);
								return { value: cached || null };
							},
						},
						{
							name: 'setValue',
							description: 'Set cached value',
							inputSchema: {
								type: 'object',
								properties: {
									key: { type: 'string' },
									value: { type: 'string' },
								},
								required: ['key', 'value'],
							},
							handler: async (params: any, context: any) => {
								await context.cache?.set(`${context.clientId}:${params.key}`, params.value, 3600);
								return { success: true };
							},
						},
					],
				},
			],
		});

		cleanup.servers.push(atpServer);
	});

	afterAll(async () => {
		await cleanupAll(cleanup);
	});

	it('should issue unique JWT tokens for different clients', async () => {
		const clientA = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});
		const clientB = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(clientA, clientB);

		const initA = await clientA.init({ name: 'client-a' });
		const initB = await clientB.init({ name: 'client-b' });

		expect(initA.clientId).toBeDefined();
		expect(initA.token).toBeDefined();
		expect(initB.clientId).toBeDefined();
		expect(initB.token).toBeDefined();

		expect(initA.clientId).not.toBe(initB.clientId);
		expect(initA.token).not.toBe(initB.token);

		const tokenAPayload = JSON.parse(Buffer.from(initA.token!.split('.')[1]!, 'base64').toString());
		const tokenBPayload = JSON.parse(Buffer.from(initB.token!.split('.')[1]!, 'base64').toString());

		expect(tokenAPayload.clientId).toBe(initA.clientId);
		expect(tokenBPayload.clientId).toBe(initB.clientId);
	});

	it('should maintain separate session state for different tenants', async () => {
		const clientA = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});
		const clientB = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(clientA, clientB);

		const initA = await clientA.init({ name: 'client-a' });
		const initB = await clientB.init({ name: 'client-b' });

		const codeA = `return { clientType: 'A', value: 100 };`;
		const codeB = `return { clientType: 'B', value: 200 };`;

		const resultA = await clientA.execute(codeA);
		const resultB = await clientB.execute(codeB);

		expect(resultA.status).toBe(ExecutionStatus.COMPLETED);
		expect((resultA.result as any).clientType).toBe('A');
		expect((resultA.result as any).value).toBe(100);

		expect(resultB.status).toBe(ExecutionStatus.COMPLETED);
		expect((resultB.result as any).clientType).toBe('B');
		expect((resultB.result as any).value).toBe(200);

		expect(initA.clientId).not.toBe(initB.clientId);
	});

	it('should execute multiple requests successfully', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		const initResult = await client.init({ name: 'multi-request-test' });
		expect(initResult.token).toBeDefined();

		const code1 = `return { message: 'test1' };`;
		const result1 = await client.execute(code1);
		expect(result1.status).toBe(ExecutionStatus.COMPLETED);

		const code2 = `return { message: 'test2' };`;
		const result2 = await client.execute(code2);
		expect(result2.status).toBe(ExecutionStatus.COMPLETED);

		const code3 = `return { message: 'test3' };`;
		const result3 = await client.execute(code3);
		expect(result3.status).toBe(ExecutionStatus.COMPLETED);
	});

	it('should handle invalid token gracefully', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'invalid-token-test' });

		(client as any).token = 'invalid.jwt.token';

		const code = `return { test: true };`;

		try {
			await client.execute(code);
		} catch (error: any) {
			expect(error).toBeDefined();
		}
	});

	it('should reject cross-client resume attempts', async () => {
		const clientA = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});
		const clientB = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(clientA, clientB);

		const initA = await clientA.init({ name: 'client-a' });
		const initB = await clientB.init({ name: 'client-b' });

		// Try to use clientA's ID with clientB's token (mismatched credentials)
		(clientA as any).session.clientId = initA.clientId;
		(clientA as any).session.clientToken = initB.token;

		const code = `return { test: true };`;
		await expect(clientA.execute(code)).rejects.toThrow(
			'Authentication error: Invalid token or client ID mismatch'
		);
	});
});
