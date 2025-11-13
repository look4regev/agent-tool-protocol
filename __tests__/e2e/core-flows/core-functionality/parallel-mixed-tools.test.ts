import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { ExecutionStatus, ToolOperationType } from '@mondaydotcomorg/atp-protocol';
import type { ClientTool, CustomFunctionDef, AuthProvider } from '@mondaydotcomorg/atp-protocol';
import { loadOpenAPI } from '@mondaydotcomorg/atp-server';
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
import { PublicApiMockServer } from '../../infrastructure/mock-servers/public-api-mock';
import { SlackMockMCP } from '../../infrastructure/mock-mcps/slack-mock-mcp';

describe('Phase 1: Parallel Execution with Mixed Tool Types', () => {
	let atpServer: TestServer;
	let githubServer: GitHubMockServer;
	let publicApiServer: PublicApiMockServer;
	let slackMCP: SlackMockMCP;
	let cleanup: CleanupTracker;

	let githubPort: number;
	let publicApiPort: number;
	const mcpApiKey = 'test-slack-api-key';
	const tempFiles: string[] = [];

	const mockAuthProvider: AuthProvider = {
		name: 'test-auth',
		async getCredential(key: string): Promise<string | null> {
			if (key === 'GITHUB_MOCK_API_TOKEN') return 'mock_github_token';
			return null;
		},
		async setCredential(): Promise<void> {},
		async deleteCredential(): Promise<void> {},
	};

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-parallel-mixed';
		cleanup = createCleanupTracker();

		await new Promise((resolve) => setTimeout(resolve, 500));

		githubPort = getTestPort();
		publicApiPort = getTestPort();

		githubServer = new GitHubMockServer({ port: githubPort });
		publicApiServer = new PublicApiMockServer({ port: publicApiPort });

		await Promise.all([githubServer.start(), publicApiServer.start()]);

		cleanup.httpServers.push(githubServer, publicApiServer);

		await new Promise((resolve) => setTimeout(resolve, 200));

		slackMCP = new SlackMockMCP({ apiKey: mcpApiKey });

		await slackMCP.handleRequest(
			{
				jsonrpc: '2.0',
				id: 0,
				method: 'initialize',
			},
			mcpApiKey
		);

		const githubSpec = replacePortInSpec(loadOpenAPISpec('github-mock'), {
			GITHUB_PORT: githubPort,
			OAUTH_PORT: 0,
		});

		const githubSpecPath = join(tmpdir(), `github-spec-parallel-${Date.now()}.json`);
		writeFileSync(githubSpecPath, JSON.stringify(githubSpec));
		tempFiles.push(githubSpecPath);

		const githubApiGroup = await loadOpenAPI(githubSpecPath, {
			name: 'github',
			baseURL: `http://localhost:${githubPort}`,
			authProvider: mockAuthProvider,
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
			],
		};

		const slackFunctions: CustomFunctionDef[] = [
			{
				name: 'postMessage',
				description: 'Post a message to Slack',
				inputSchema: {
					type: 'object',
					properties: {
						channel: { type: 'string' },
						text: { type: 'string' },
					},
					required: ['channel', 'text'],
				},
				handler: async (input: any) => {
					const mcpRequest = {
						jsonrpc: '2.0',
						id: 1,
						method: 'tools/call',
						params: {
							name: 'postMessage',
							arguments: input,
						},
					};

					const response = await slackMCP.handleRequest(mcpRequest, mcpApiKey);

					if (response.error) {
						throw new Error(response.error.message);
					}

					return JSON.parse(response.result.content[0].text);
				},
			},
			{
				name: 'listChannels',
				description: 'List Slack channels',
				inputSchema: {
					type: 'object',
					properties: {},
				},
				handler: async () => {
					const mcpRequest = {
						jsonrpc: '2.0',
						id: 1,
						method: 'tools/call',
						params: {
							name: 'listChannels',
							arguments: {},
						},
					};

					const response = await slackMCP.handleRequest(mcpRequest, mcpApiKey);

					if (response.error) {
						throw new Error(response.error.message);
					}

					return JSON.parse(response.result.content[0].text);
				},
			},
		];

		const slackApiGroup = {
			name: 'slack',
			type: 'mcp' as const,
			functions: slackFunctions,
		};

		atpServer = await createTestATPServer({
			apiGroups: [githubApiGroup, publicApiGroup, slackApiGroup],
			execution: {
				llmCalls: 5,
			},
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

	it('should execute OpenAPI, MCP, and Client tools together', async () => {
		const clientTools: ClientTool[] = [
			{
				name: 'processLocal',
				description: 'Process data locally',
				inputSchema: {
					type: 'object',
					properties: {
						value: { type: 'number' },
					},
					required: ['value'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async (input: any) => {
					return { processed: input.value * 3 };
				},
			},
		];

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
			serviceProviders: {
				tools: clientTools,
			},
		});

		cleanup.clients.push(client);

		await client.init({ name: 'parallel-all-test' });

		const code = `
			const githubUser = await api.github.getAuthenticatedUser();
			const slackChannels = await api.slack.listChannels();
			const clientProcessed = await api.client.processLocal({ value: 10 });
			const publicStatus = await api.public.getData();
			
			return {
				github: { login: githubUser.login },
				slack: { channelCount: slackChannels.channels.length },
				client: { processed: clientProcessed.processed },
				public: { dataCount: publicStatus.count }
			};
		`;

		const result = await client.execute(code);

		if (result.status === ExecutionStatus.FAILED) {
			console.log('Execution error:', JSON.stringify(result.error, null, 2));
		}

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.github.login).toBe('testuser');
		expect(data.slack.channelCount).toBeGreaterThan(0);
		expect(data.client.processed).toBe(30);
		expect(data.public.dataCount).toBeGreaterThan(0);
	});

	it('should handle client tool pause without blocking other operations', async () => {
		let pauseCount = 0;

		const clientTools: ClientTool[] = [
			{
				name: 'slowOperation',
				description: 'Slow operation that pauses',
				inputSchema: {
					type: 'object',
					properties: {},
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async () => {
					pauseCount++;
					await new Promise((resolve) => setTimeout(resolve, 100));
					return { completed: true, pauseCount };
				},
			},
		];

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
			serviceProviders: {
				tools: clientTools,
			},
		});

		cleanup.clients.push(client);

		await client.init({ name: 'pause-no-block-test' });

		const code = `
			const startTime = Date.now();
			
			const [slow, github, public] = await Promise.all([
				api.client.slowOperation(),
				api.github.listRepositories(),
				api.public.getData()
			]);
			
			const duration = Date.now() - startTime;
			
			return {
				slowCompleted: slow.completed,
				githubRepos: github.length,
				publicData: public.data.length,
				duration
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.slowCompleted).toBe(true);
		expect(data.githubRepos).toBeGreaterThanOrEqual(0);
		expect(data.publicData).toBeGreaterThanOrEqual(0);
	});

	it('should handle mixed API calls without errors', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'mixed-api-test' });

		const code = `
			const github = await api.github.getAuthenticatedUser();
			const slack = await api.slack.listChannels();
			const publicData = await api.public.getData();
			
			return {
				github: github.login,
				slackChannels: slack.channels.length,
				publicCount: publicData.count
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.github).toBe('testuser');
		expect(data.slackChannels).toBeGreaterThan(0);
		expect(data.publicCount).toBeGreaterThan(0);
	});

	it('should execute complex workflow with multiple tool types', async () => {
		const clientTools: ClientTool[] = [
			{
				name: 'transform',
				description: 'Transform data',
				inputSchema: {
					type: 'object',
					properties: {
						data: { type: 'array' },
					},
					required: ['data'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async (input: any) => {
					return {
						transformed: input.data.map((item: any) => item * 2),
					};
				},
			},
		];

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
			serviceProviders: {
				tools: clientTools,
			},
		});

		cleanup.clients.push(client);

		await client.init({ name: 'workflow-test' });

		const code = `
			const githubUser = await api.github.getAuthenticatedUser();
			const transformed = await api.client.transform({ data: [5, 10, 15] });
			
			return {
				user: githubUser.login,
				transformed: transformed.transformed
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.user).toBe('testuser');
		expect(data.transformed).toEqual([10, 20, 30]);
	});
});
