import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ChatOpenAI } from '@langchain/openai';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';
import { loadOpenAPI } from '@agent-tool-protocol/server';
import type { AuthProvider } from '@mondaydotcomorg/atp-protocol';
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
import { GitHubMockServer } from '../infrastructure/mock-servers/github-mock';
import { StripeMockServer } from '../infrastructure/mock-servers/stripe-mock';

describe('LangChain: OpenAPI with Auth Integration', () => {
	let atpServer: TestServer;
	let githubServer: GitHubMockServer;
	let stripeServer: StripeMockServer;
	let cleanup: CleanupTracker;
	let githubPort: number;
	let stripePort: number;
	const tempFiles: string[] = [];
	const createdTools: any[] = [];

	const mockAuthProvider: AuthProvider = {
		name: 'test-auth',
		async getCredential(key: string): Promise<string | null> {
			const credentials: Record<string, string> = {
				GITHUB_MOCK_API_TOKEN: 'mock_github_token',
				STRIPE_MOCK_API_TOKEN: 'sk_test_mock_stripe_key',
			};
			return credentials[key] || null;
		},
		async setCredential(): Promise<void> {},
		async deleteCredential(): Promise<void> {},
	};

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-langchain-openapi';
		process.env.OPENAI_API_KEY = 'sk-fake-key-for-testing';
		cleanup = createCleanupTracker();

		await new Promise((resolve) => setTimeout(resolve, 500));

		githubPort = getTestPort();
		stripePort = getTestPort();

		githubServer = new GitHubMockServer({ port: githubPort });
		stripeServer = new StripeMockServer({ port: stripePort });

		await Promise.all([githubServer.start(), stripeServer.start()]);
		cleanup.httpServers.push(githubServer, stripeServer);
		await new Promise((resolve) => setTimeout(resolve, 200));

		const githubSpec = replacePortInSpec(loadOpenAPISpec('github-mock'), {
			GITHUB_PORT: githubPort,
			OAUTH_PORT: 0,
		});
		const stripeSpec = replacePortInSpec(loadOpenAPISpec('stripe-mock'), {
			STRIPE_PORT: stripePort,
		});

		const githubSpecPath = join(tmpdir(), `github-spec-langchain-${Date.now()}.json`);
		const stripeSpecPath = join(tmpdir(), `stripe-spec-langchain-${Date.now()}.json`);

		writeFileSync(githubSpecPath, JSON.stringify(githubSpec));
		writeFileSync(stripeSpecPath, JSON.stringify(stripeSpec));

		tempFiles.push(githubSpecPath, stripeSpecPath);

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

		atpServer = await createTestATPServer({
			apiGroups: [githubApiGroup, stripeApiGroup],
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

	it('should create LangChain tools from OpenAPI with Bearer auth', async () => {
		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		const { client, tools } = await createATPTools({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
		});
		createdTools.push({ client });

		expect(tools).toBeDefined();
		expect(tools.length).toBeGreaterThan(0);

		const executeCodeTool = tools.find((t) => t.name === 'atp_execute_code');
		expect(executeCodeTool).toBeDefined();
	});

	it('should execute OpenAPI calls through LangChain tools with auth', async () => {
		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		const { client, tools } = await createATPTools({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
		});
		createdTools.push({ client });

		const executeCodeTool = tools.find((t) => t.name === 'atp_execute_code');
		expect(executeCodeTool).toBeDefined();

		const code = `
			const user = await api.github.getAuthenticatedUser();
			const customers = await api.stripe.listCustomers();
			
			return {
				githubUser: user.login,
				stripeCustomerCount: customers.data.length
			};
		`;

		const result = await executeCodeTool!.invoke(code);
		const parsed = typeof result === 'string' ? JSON.parse(result) : result;

		expect(parsed.success).toBe(true);
		expect(parsed.result.githubUser).toBe('testuser');
		expect(parsed.result.stripeCustomerCount).toBeGreaterThanOrEqual(0);
	});

	it('should provide search_api tool for LangChain', async () => {
		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		const { client, tools } = await createATPTools({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
		});
		createdTools.push({ client });

		const searchTool = tools.find((t) => t.name === 'atp_search_api');
		expect(searchTool).toBeDefined();

		const searchResult = await searchTool!.invoke({ query: 'user' });
		const parsed = typeof searchResult === 'string' ? JSON.parse(searchResult) : searchResult;

		if (!Array.isArray(parsed)) {
			console.log('Search result format:', JSON.stringify(parsed, null, 2));
		}

		expect(Array.isArray(parsed) || (parsed && Array.isArray(parsed.results))).toBe(true);
		const results = Array.isArray(parsed) ? parsed : parsed.results || [];
		expect(results.length).toBeGreaterThan(0);
	});

	it('should provide fetch_all_apis tool for LangChain', async () => {
		const llm = new ChatOpenAI({
			modelName: 'gpt-4',
			openAIApiKey: 'sk-fake-key',
		});

		const { client, tools } = await createATPTools({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
		});
		createdTools.push({ client });

		const fetchTool = tools.find((t) => t.name === 'atp_fetch_all_apis');
		expect(fetchTool).toBeDefined();

		const result = await fetchTool!.invoke({ apiGroups: ['github', 'stripe'] });
		const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
		expect(resultStr).toBeDefined();
		expect(resultStr.length).toBeGreaterThan(0);
	});
});
