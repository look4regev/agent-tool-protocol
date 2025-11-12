import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import {
	createCleanupTracker,
	cleanupAll,
	getTestPort,
	waitForServer,
	loadOpenAPISpec,
	replacePortInSpec,
	type CleanupTracker,
} from '../infrastructure/test-helpers';
import { MockOAuthProvider } from '../infrastructure/mock-servers/oauth-provider-mock';
import { GitHubMockServer } from '../infrastructure/mock-servers/github-mock';
import { StripeMockServer } from '../infrastructure/mock-servers/stripe-mock';
import { ProtectedApiMockServer } from '../infrastructure/mock-servers/protected-api-mock';
import { PublicApiMockServer } from '../infrastructure/mock-servers/public-api-mock';
import { FilesystemMockMCP } from '../infrastructure/mock-mcps/filesystem-mock-mcp';
import { DatabaseMockMCP } from '../infrastructure/mock-mcps/database-mock-mcp';
import { SlackMockMCP } from '../infrastructure/mock-mcps/slack-mock-mcp';

describe('Infrastructure Validation', () => {
	let cleanup: CleanupTracker;

	beforeAll(() => {
		cleanup = createCleanupTracker();
	});

	afterAll(async () => {
		await cleanupAll(cleanup);
	});

	describe('Mock OAuth Provider', () => {
		it('should start and issue tokens', async () => {
			const port = getTestPort();
			const provider = new MockOAuthProvider(port);

			await provider.start();
			cleanup.httpServers.push(provider);

			const tokenResponse = provider.issueToken('test-user', ['read', 'write'], 3600);

			expect(tokenResponse.access_token).toBeDefined();
			expect(tokenResponse.token_type).toBe('Bearer');
			expect(tokenResponse.expires_in).toBe(3600);
			expect(tokenResponse.scope).toBe('read write');

			const introspection = await provider.introspect(tokenResponse.access_token);

			expect(introspection.valid).toBe(true);
			expect(introspection.scopes).toEqual(['read', 'write']);
			expect(introspection.userId).toBe('test-user');

			await provider.stop();
		});

		it('should handle token refresh', async () => {
			const port = getTestPort();
			const provider = new MockOAuthProvider(port);

			await provider.start();
			cleanup.httpServers.push(provider);

			const tokenResponse = provider.issueToken('test-user', ['read'], 3600);
			const refreshToken = tokenResponse.refresh_token!;

			const refreshed = await provider.refresh(refreshToken);

			expect(refreshed.access_token).toBeDefined();
			expect(refreshed.access_token).not.toBe(tokenResponse.access_token);

			await provider.stop();
		});
	});

	describe('Mock OpenAPI Servers', () => {
		it('should start GitHub mock server', async () => {
			const port = getTestPort();
			const server = new GitHubMockServer({ port });

			await server.start();
			cleanup.httpServers.push(server);

			await new Promise((resolve) => setTimeout(resolve, 100));

			const response = await fetch(`http://localhost:${port}/user`, {
				headers: { Authorization: 'Bearer test_token' },
			});

			expect([200, 401]).toContain(response.status);

			await server.stop();
		});

		it('should start Stripe mock server', async () => {
			const port = getTestPort();
			const server = new StripeMockServer({ port });

			await server.start();
			cleanup.httpServers.push(server);

			await new Promise((resolve) => setTimeout(resolve, 100));

			const response = await fetch(`http://localhost:${port}/v1/customers`, {
				headers: { Authorization: 'Bearer sk_test_mock' },
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.object).toBe('list');

			await server.stop();
		});

		it('should start Protected API mock server', async () => {
			const port = getTestPort();
			const server = new ProtectedApiMockServer({
				port,
				token: 'test-token-123',
			});

			await server.start();
			cleanup.httpServers.push(server);

			await new Promise((resolve) => setTimeout(resolve, 100));

			const response = await fetch(`http://localhost:${port}/protected/resource`, {
				headers: { Authorization: `Bearer test-token-123` },
			});

			expect(response.status).toBe(200);

			await server.stop();
		});

		it('should start Public API mock server', async () => {
			const port = getTestPort();
			const server = new PublicApiMockServer({ port });

			await server.start();
			cleanup.httpServers.push(server);

			await new Promise((resolve) => setTimeout(resolve, 100));

			const response = await fetch(`http://localhost:${port}/public/status`);

			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.status).toBe('ok');

			await server.stop();
		});
	});

	describe('Mock MCP Servers', () => {
		it('should initialize Filesystem MCP', async () => {
			const mcp = new FilesystemMockMCP({ authToken: 'test-token' });

			const initResponse = await mcp.handleRequest(
				{
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
				},
				'test-token'
			);

			expect(initResponse.result).toBeDefined();
			expect(initResponse.result.serverInfo.name).toBe('filesystem-mock-mcp');
		});

		it('should list Filesystem MCP tools', async () => {
			const mcp = new FilesystemMockMCP({ authToken: 'test-token' });

			await mcp.handleRequest(
				{
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
				},
				'test-token'
			);

			const listResponse = await mcp.handleRequest(
				{
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/list',
				},
				'test-token'
			);

			expect(listResponse.result).toBeDefined();
			expect(listResponse.result.tools.length).toBeGreaterThan(0);
			expect(listResponse.result.tools.some((t: any) => t.name === 'readFile')).toBe(true);
		});

		it('should execute Filesystem MCP tool', async () => {
			const mcp = new FilesystemMockMCP({ authToken: 'test-token' });

			await mcp.handleRequest(
				{
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
				},
				'test-token'
			);

			const callResponse = await mcp.handleRequest(
				{
					jsonrpc: '2.0',
					id: 3,
					method: 'tools/call',
					params: {
						name: 'readFile',
						arguments: { path: '/test/file1.txt' },
					},
				},
				'test-token'
			);

			expect(callResponse.result).toBeDefined();
			expect(callResponse.result.content).toBeDefined();
		});

		it('should initialize Database MCP with OAuth', async () => {
			const oauthPort = getTestPort();
			const oauthProvider = new MockOAuthProvider(oauthPort);

			await oauthProvider.start();
			cleanup.httpServers.push(oauthProvider);

			const tokenResponse = oauthProvider.issueToken('test-user', ['db:read', 'db:write'], 3600);

			const mcp = new DatabaseMockMCP({
				oauthIntrospectUrl: `http://localhost:${oauthPort}/oauth/introspect`,
			});

			const initResponse = await mcp.handleRequest(
				{
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
				},
				tokenResponse.access_token
			);

			expect(initResponse.result).toBeDefined();
			expect(initResponse.result.serverInfo.name).toBe('database-mock-mcp');

			await oauthProvider.stop();
		});

		it('should initialize Slack MCP', async () => {
			const mcp = new SlackMockMCP({ apiKey: 'test-api-key' });

			const initResponse = await mcp.handleRequest(
				{
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
				},
				'test-api-key'
			);

			expect(initResponse.result).toBeDefined();
			expect(initResponse.result.serverInfo.name).toBe('slack-mock-mcp');
		});
	});

	describe('OpenAPI Specs', () => {
		it('should load GitHub mock spec', () => {
			const spec = loadOpenAPISpec('github-mock');

			expect(spec).toBeDefined();
			expect(spec.openapi).toBe('3.0.0');
			expect(spec.info.title).toBe('GitHub Mock API');
			expect(spec.paths).toBeDefined();
		});

		it('should load Stripe mock spec', () => {
			const spec = loadOpenAPISpec('stripe-mock');

			expect(spec).toBeDefined();
			expect(spec.openapi).toBe('3.0.0');
			expect(spec.info.title).toBe('Stripe Mock API');
		});

		it('should load Protected API mock spec', () => {
			const spec = loadOpenAPISpec('basic-auth-mock');

			expect(spec).toBeDefined();
			expect(spec.openapi).toBe('3.0.0');
			expect(spec.info.title).toBe('Protected API');
		});

		it('should replace ports in spec', () => {
			const spec = loadOpenAPISpec('github-mock');
			const replaced = replacePortInSpec(spec, {
				GITHUB_PORT: 9999,
			});

			expect(JSON.stringify(replaced)).toContain('9999');
			expect(JSON.stringify(replaced)).not.toContain('GITHUB_PORT');
		});
	});
});
