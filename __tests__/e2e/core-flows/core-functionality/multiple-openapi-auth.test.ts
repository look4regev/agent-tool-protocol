import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { ExecutionStatus, type AuthProvider } from '@agent-tool-protocol/protocol';
import { loadOpenAPI } from '@agent-tool-protocol/server';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	createTestATPServer,
	createCleanupTracker,
	cleanupAll,
	getTestPort,
	waitForServer,
	loadOpenAPISpec,
	replacePortInSpec,
	type TestServer,
	type CleanupTracker,
} from '../../infrastructure/test-helpers';
import { GitHubMockServer } from '../../infrastructure/mock-servers/github-mock';
import { StripeMockServer } from '../../infrastructure/mock-servers/stripe-mock';
import { ProtectedApiMockServer } from '../../infrastructure/mock-servers/protected-api-mock';
import { PublicApiMockServer } from '../../infrastructure/mock-servers/public-api-mock';

describe('Phase 1: Multiple OpenAPI with Different Auth', () => {
	let atpServer: TestServer;
	let githubServer: GitHubMockServer;
	let stripeServer: StripeMockServer;
	let protectedApiServer: ProtectedApiMockServer;
	let publicApiServer: PublicApiMockServer;
	let cleanup: CleanupTracker;

	let githubPort: number;
	let stripePort: number;
	let protectedApiPort: number;
	let publicApiPort: number;

	const tempFiles: string[] = [];
	const credentials: Record<string, string> = {};

	const mockAuthProvider: AuthProvider = {
		name: 'test-auth',
		async getCredential(key: string): Promise<string | null> {
			return credentials[key] || process.env[key] || null;
		},
		async setCredential(key: string, value: string): Promise<void> {
			credentials[key] = value;
		},
		async deleteCredential(key: string): Promise<void> {
			delete credentials[key];
		},
	};

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-multi-openapi-auth';
		cleanup = createCleanupTracker();

		await new Promise((resolve) => setTimeout(resolve, 500));

		githubPort = getTestPort();
		stripePort = getTestPort();
		protectedApiPort = getTestPort();
		publicApiPort = getTestPort();

		githubServer = new GitHubMockServer({ port: githubPort });
		stripeServer = new StripeMockServer({ port: stripePort });
		protectedApiServer = new ProtectedApiMockServer({
			port: protectedApiPort,
			token: 'test-protected-token',
		});
		publicApiServer = new PublicApiMockServer({ port: publicApiPort });

		await Promise.all([
			githubServer.start(),
			stripeServer.start(),
			protectedApiServer.start(),
			publicApiServer.start(),
		]);

		cleanup.httpServers.push(githubServer, stripeServer, protectedApiServer, publicApiServer);

		await new Promise((resolve) => setTimeout(resolve, 200));

		const githubSpec = replacePortInSpec(loadOpenAPISpec('github-mock'), {
			GITHUB_PORT: githubPort,
			OAUTH_PORT: 0,
		});
		const stripeSpec = replacePortInSpec(loadOpenAPISpec('stripe-mock'), {
			STRIPE_PORT: stripePort,
		});
		const protectedApiSpec = replacePortInSpec(loadOpenAPISpec('basic-auth-mock'), {
			PROTECTED_API_PORT: protectedApiPort,
		});

		const githubSpecPath = join(tmpdir(), `github-spec-${Date.now()}.json`);
		const stripeSpecPath = join(tmpdir(), `stripe-spec-${Date.now()}.json`);
		const protectedApiSpecPath = join(tmpdir(), `protected-api-spec-${Date.now()}.json`);

		writeFileSync(githubSpecPath, JSON.stringify(githubSpec));
		writeFileSync(stripeSpecPath, JSON.stringify(stripeSpec));
		writeFileSync(protectedApiSpecPath, JSON.stringify(protectedApiSpec));

		tempFiles.push(githubSpecPath, stripeSpecPath, protectedApiSpecPath);

		credentials.GITHUB_MOCK_API_TOKEN = 'mock_github_token';
		credentials.STRIPE_MOCK_API_TOKEN = 'sk_test_mock_stripe_key';
		process.env.PROTECTED_API_TOKEN = 'test-protected-token';

		const githubApiGroup = await loadOpenAPI(githubSpecPath, {
			name: 'github',
			baseURL: `http://localhost:${githubPort}`,
			authProvider: mockAuthProvider,
		});

		const stripeApiGroup = await loadOpenAPI(stripeSpecPath, {
			name: 'stripe',
			baseURL: `http://localhost:${stripePort}`,
			authProvider: mockAuthProvider,
		});

		const protectedApiGroup = await loadOpenAPI(protectedApiSpecPath, {
			name: 'protected',
			baseURL: `http://localhost:${protectedApiPort}`,
		});

		const publicApiGroup = {
			name: 'public',
			type: 'custom' as const,
			functions: [
				{
					name: 'getData',
					description: 'Get public data',
					inputSchema: {
						type: 'object',
						properties: {
							category: { type: 'string' },
						},
					},
					handler: async (params: any) => {
						const url = new URL(`http://localhost:${publicApiPort}/public/data`);
						if (params && params.category) {
							url.searchParams.set('category', params.category);
						}
						const response = await fetch(url.toString());
						return await response.json();
					},
				},
				{
					name: 'getStatus',
					description: 'Get API status',
					inputSchema: {
						type: 'object',
						properties: {},
					},
					handler: async () => {
						const response = await fetch(`http://localhost:${publicApiPort}/public/status`);
						return await response.json();
					},
				},
			],
		};

		atpServer = await createTestATPServer({
			apiGroups: [githubApiGroup, stripeApiGroup, protectedApiGroup, publicApiGroup],
		});

		cleanup.servers.push(atpServer);
	});

	afterAll(async () => {
		await cleanupAll(cleanup);

		tempFiles.forEach((file) => {
			try {
				unlinkSync(file);
			} catch (e) {
				// Ignore
			}
		});
	});

	it('should call all 4 APIs with correct authentication', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'multi-api-client' });

		const code = `
			const github = await api.github.getAuthenticatedUser();
			const stripe = await api.stripe.listCustomers();
			const protectedRes = await api.protected.getProtectedResource();
			const publicRes = await api.public.getStatus();
			
			return {
				github: github,
				stripe: stripe,
				protected: protectedRes,
				public: publicRes
			};
		`;

		const result = await client.execute(code);

		if (result.status === ExecutionStatus.FAILED) {
			console.log('Execution failed:', JSON.stringify(result, null, 2));
		}

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.github).toBeDefined();
		expect(data.github.login).toBe('testuser');

		expect(data.stripe).toBeDefined();
		expect(data.stripe.object).toBe('list');
		expect(Array.isArray(data.stripe.data)).toBe(true);

		expect(data.protected).toBeDefined();
		expect(Array.isArray(data.protected.resources)).toBe(true);

		expect(data.public).toBeDefined();
		expect(data.public.status).toBe('ok');
	});

	it('should handle auth failure for GitHub independently', async () => {
		await mockAuthProvider.deleteCredential('GITHUB_MOCK_API_TOKEN');

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'auth-failure-client' });

		const code = `
			await api.github.getAuthenticatedUser();
			return { message: 'Should have failed' };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.FAILED);
		expect(result.error).toBeDefined();

		await mockAuthProvider.setCredential('GITHUB_MOCK_API_TOKEN', 'mock_github_token');
	});

	it('should handle auth failure for Stripe independently', async () => {
		await mockAuthProvider.deleteCredential('STRIPE_MOCK_API_TOKEN');

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'stripe-auth-failure-client' });

		const code = `
			await api.stripe.listCustomers();
			return { message: 'Should have failed' };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.FAILED);
		expect(result.error).toBeDefined();

		await mockAuthProvider.setCredential('STRIPE_MOCK_API_TOKEN', 'sk_test_mock_stripe_key');
	});

	it('should verify public API works without authentication', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'public-api-client' });

		const code = `
			const status = await api.public.getStatus();
			const data = await api.public.getData({ category: 'general' });
			
			return { 
				statusValue: status.status,
				dataItems: data.data,
				dataCount: data.count
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const responseData = result.result as any;

		expect(responseData.statusValue).toBe('ok');
		expect(Array.isArray(responseData.dataItems)).toBe(true);
		expect(responseData.dataCount).toBeGreaterThan(0);
	});
});
