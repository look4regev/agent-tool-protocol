import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ChatOpenAI } from '@langchain/openai';
import { createATPTools, LangGraphATPClient } from '@agent-tool-protocol/langchain';
import { loadOpenAPI } from '@agent-tool-protocol/server';
import type { ClientTool } from '@agent-tool-protocol/protocol';
import { ToolOperationType } from '@agent-tool-protocol/protocol';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	createTestATPServer,
	createCleanupTracker,
	cleanupAll,
	getTestPort,
	loadOpenAPISpec,
	replacePortInSpec,
	type TestServer,
	type CleanupTracker,
} from '../infrastructure/test-helpers';
import { MockOAuthProvider } from '../infrastructure/mock-servers/oauth-provider-mock';
import { GitHubMockServer } from '../infrastructure/mock-servers/github-mock';

describe('LangGraph: OAuth Scope Filtering', () => {
	let atpServer: TestServer;
	let oauthProvider: MockOAuthProvider;
	let githubServer: GitHubMockServer;
	let cleanup: CleanupTracker;
	let oauthPort: number;
	let githubPort: number;
	const tempFiles: string[] = [];
	const createdTools: any[] = [];
	const createdClients: LangGraphATPClient[] = [];

	let userLimitedToken: string;
	let userFullToken: string;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-langgraph-oauth';
		process.env.OPENAI_API_KEY = 'sk-fake-key-for-testing';
		cleanup = createCleanupTracker();

		await new Promise((resolve) => setTimeout(resolve, 500));

		oauthPort = getTestPort();
		githubPort = getTestPort();

		oauthProvider = new MockOAuthProvider(oauthPort);
		await oauthProvider.start();
		cleanup.httpServers.push(oauthProvider);

		const limitedTokens = oauthProvider.issueToken('user-limited', ['read:user'], 3600);
		const fullTokens = oauthProvider.issueToken(
			'user-full',
			['repo', 'read:user', 'admin:org'],
			3600
		);

		userLimitedToken = limitedTokens.access_token;
		userFullToken = fullTokens.access_token;

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

		const githubSpecPath = join(tmpdir(), `github-spec-langgraph-oauth-${Date.now()}.json`);
		writeFileSync(githubSpecPath, JSON.stringify(githubSpec));
		tempFiles.push(githubSpecPath);

		process.env.GITHUB_MOCK_API_TOKEN = userLimitedToken;

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
		for (const toolSet of createdTools) {
			try {
				if (toolSet.client) {
					await toolSet.client.close?.();
				}
			} catch (e) {
				// Ignore
			}
		}
		createdTools.length = 0;

		await cleanupAll(cleanup);

		tempFiles.forEach((file) => {
			try {
				unlinkSync(file);
			} catch (e) {
				// Ignore
			}
		});
	});

	it('should enforce OAuth scopes through LangChain with limited access', async () => {
		process.env.GITHUB_MOCK_API_TOKEN = userLimitedToken;

		const llm = new ChatOpenAI({ modelName: 'gpt-4', openAIApiKey: 'sk-fake-key' });
		const { client, tools } = await createATPTools({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
		});
		createdTools.push({ client });

		const executeCodeTool = tools.find((t) => t.name === 'atp_execute_code');

		const code = `
			const user = await api.github.getAuthenticatedUser();
			
			try {
				const repos = await api.github.listRepositories();
				return { user: user.login, repoAccessDenied: false };
			} catch (error) {
				return { user: user.login, repoAccessDenied: true, error: error.message };
			}
		`;

		const result = await executeCodeTool!.invoke(code);
		const parsed = JSON.parse(result);

		expect(parsed.success).toBe(true);
		expect(parsed.result.user).toBe('testuser');
		expect(parsed.result.repoAccessDenied).toBe(true);
		expect(parsed.result.error).toContain('Insufficient scope');
	});

	it('should allow full access with complete scopes through LangChain', async () => {
		process.env.GITHUB_MOCK_API_TOKEN = userFullToken;

		const llm = new ChatOpenAI({ modelName: 'gpt-4', openAIApiKey: 'sk-fake-key' });
		const { client, tools } = await createATPTools({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
		});
		createdTools.push({ client });

		const executeCodeTool = tools.find((t) => t.name === 'atp_execute_code');

		const code = `
			const user = await api.github.getAuthenticatedUser();
			const repos = await api.github.listRepositories();
			const org = await api.github.getOrganization({ org: 'test-org' });
			
			return {
				user: user.login,
				repoCount: repos.length,
				org: org.login,
				fullAccess: true
			};
		`;

		const result = await executeCodeTool!.invoke(code);
		const parsed = JSON.parse(result);

		expect(parsed.success).toBe(true);
		expect(parsed.result.user).toBe('testuser');
		expect(parsed.result.repoCount).toBeGreaterThanOrEqual(0);
		expect(parsed.result.org).toBe('test-org');
		expect(parsed.result.fullAccess).toBe(true);
	});

	it('should handle OAuth with different users through LangChain', async () => {
		process.env.GITHUB_MOCK_API_TOKEN = userLimitedToken;
		const llm = new ChatOpenAI({ modelName: 'gpt-4', openAIApiKey: 'sk-fake-key' });
		const { client, tools } = await createATPTools({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
		});
		createdTools.push({ client });

		const executeCodeTool = tools.find((t) => t.name === 'atp_execute_code');

		const code = `
			const user = await api.github.getAuthenticatedUser();
			return { user: user.login };
		`;

		const result = await executeCodeTool!.invoke(code);
		const parsed = JSON.parse(result);

		expect(parsed.success).toBe(true);
		expect(parsed.result.user).toBe('testuser');
	});
});
