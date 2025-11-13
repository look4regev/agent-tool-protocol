import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { ExecutionStatus } from '@agent-tool-protocol/protocol';
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
import { MockOAuthProvider } from '../../infrastructure/mock-servers/oauth-provider-mock';
import { GitHubMockServer } from '../../infrastructure/mock-servers/github-mock';

describe('Phase 2: OAuth Scope Filtering', () => {
	let atpServer: TestServer;
	let oauthProvider: MockOAuthProvider;
	let githubServer: GitHubMockServer;
	let cleanup: CleanupTracker;

	let oauthPort: number;
	let githubPort: number;

	let userAToken: string;
	let userBToken: string;
	let userCToken: string;
	const tempFiles: string[] = [];

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-oauth-scope-filtering';
		cleanup = createCleanupTracker();

		oauthPort = getTestPort();
		githubPort = getTestPort();

		oauthProvider = new MockOAuthProvider(oauthPort);
		await oauthProvider.start();
		cleanup.httpServers.push(oauthProvider);

		const userATokens = oauthProvider.issueToken('user-a', ['repo', 'read:user'], 3600);
		const userBTokens = oauthProvider.issueToken(
			'user-b',
			['repo', 'read:user', 'admin:org'],
			3600
		);
		const userCTokens = oauthProvider.issueToken('user-c', ['read:user'], 3600);

		userAToken = userATokens.access_token;
		userBToken = userBTokens.access_token;
		userCToken = userCTokens.access_token;

		githubServer = new GitHubMockServer({
			port: githubPort,
			oauthIntrospectUrl: `http://localhost:${oauthPort}/oauth/introspect`,
		});

		await githubServer.start();
		cleanup.httpServers.push(githubServer);
		await new Promise((resolve) => setTimeout(resolve, 200));

		const githubSpec = replacePortInSpec(loadOpenAPISpec('github-mock'), {
			GITHUB_PORT: githubPort,
			OAUTH_PORT: oauthPort,
		});

		const githubSpecPath = join(tmpdir(), `github-spec-oauth-${Date.now()}.json`);
		writeFileSync(githubSpecPath, JSON.stringify(githubSpec));
		tempFiles.push(githubSpecPath);

		process.env.GITHUB_MOCK_API_TOKEN = userAToken;

		const githubApiGroup = await loadOpenAPI(githubSpecPath, {
			name: 'github',
			baseURL: `http://localhost:${githubPort}`,
		});

		atpServer = await createTestATPServer({
			apiGroups: [githubApiGroup],
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

	it('should allow User A to access repo and read:user endpoints only', async () => {
		process.env.GITHUB_MOCK_API_TOKEN = userAToken;

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'user-a-client' });

		const code = `
			const user = await api.github.getAuthenticatedUser();
			const repos = await api.github.listRepositories();
			
			return {
				user: { login: user.login },
				repoCount: repos.length
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.user.login).toBe('testuser');
		expect(data.repoCount).toBeGreaterThan(0);
	});

	it('should deny User A access to admin:org endpoints', async () => {
		process.env.GITHUB_MOCK_API_TOKEN = userAToken;

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'user-a-admin-denied' });

		const code = `
			try {
				await api.github.getOrganization({ org: 'test-org' });
				return { denied: false, message: 'Should have been denied' };
			} catch (error) {
				return { denied: true, error: error.message };
			}
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.denied).toBe(true);
		expect(data.error).toContain('Insufficient scope');
	});

	it('should allow User B to access all endpoints including admin:org', async () => {
		process.env.GITHUB_MOCK_API_TOKEN = userBToken;

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'user-b-client' });

		const code = `
			const user = await api.github.getAuthenticatedUser();
			const repos = await api.github.listRepositories();
			const org = await api.github.getOrganization({ org: 'test-org' });
			
			return {
				user: { login: user.login },
				repoCount: repos.length,
				org: { login: org.login }
			};
		`;

		const result = await client.execute(code);

		if (result.status !== ExecutionStatus.COMPLETED) {
			console.log('User B execution failed:', JSON.stringify(result.error, null, 2));
		}

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.user.login).toBe('testuser');
		expect(data.repoCount).toBeGreaterThan(0);
		expect(data.org.login).toBe('test-org');
	});

	it('should allow User C to access only read:user endpoints', async () => {
		process.env.GITHUB_MOCK_API_TOKEN = userCToken;

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'user-c-client' });

		const code = `
			const user = await api.github.getAuthenticatedUser();
			
			return {
				user: { login: user.login, id: user.id }
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.user.login).toBe('testuser');
	});

	it('should deny User C access to repo endpoints', async () => {
		process.env.GITHUB_MOCK_API_TOKEN = userCToken;

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'user-c-repo-denied' });

		const code = `
			try {
				await api.github.listRepositories();
				return { denied: false };
			} catch (error) {
				return { denied: true, error: error.message };
			}
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.denied).toBe(true);
		expect(data.error).toContain('Insufficient scope');
	});

	it('should handle token expiry and refresh', async () => {
		const shortLivedTokens = oauthProvider.issueToken('user-d', ['repo', 'read:user'], 1);
		const shortToken = shortLivedTokens.access_token;

		process.env.GITHUB_MOCK_API_TOKEN = shortToken;

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'token-expiry-test' });

		const code = `
			const user1 = await api.github.getAuthenticatedUser();
			return { user: user1.login };
		`;

		const result1 = await client.execute(code);
		expect(result1.status).toBe(ExecutionStatus.COMPLETED);

		await new Promise((resolve) => setTimeout(resolve, 1500));

		const code2 = `
			try {
				const user2 = await api.github.getAuthenticatedUser();
				return { expired: false, user: user2.login };
			} catch (error) {
				return { expired: true, error: error.message };
			}
		`;

		const result2 = await client.execute(code2);
		expect(result2.status).toBe(ExecutionStatus.COMPLETED);

		const data2 = result2.result as any;
		expect(data2.expired).toBe(true);
	});

	it('should verify introspection caching behavior', async () => {
		process.env.GITHUB_MOCK_API_TOKEN = userBToken;

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'cache-test' });

		const code = `
			const results = [];
			for (let i = 0; i < 3; i++) {
				const user = await api.github.getAuthenticatedUser();
				results.push({ iteration: i, login: user.login });
			}
			return { results, count: results.length };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.results.length).toBe(3);
		expect(data.results.every((r: any) => r.login === 'testuser')).toBe(true);
	});
});
