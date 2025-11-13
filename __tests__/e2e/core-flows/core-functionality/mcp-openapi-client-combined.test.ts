import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { ExecutionStatus, ToolOperationType } from '@agent-tool-protocol/protocol';
import type { ClientTool, CustomFunctionDef, AuthProvider } from '@agent-tool-protocol/protocol';
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
import { FilesystemMockMCP } from '../../infrastructure/mock-mcps/filesystem-mock-mcp';

describe('Phase 1: MCP + OpenAPI + Client Tools Combined', () => {
	let atpServer: TestServer;
	let githubServer: GitHubMockServer;
	let filesystemMCP: FilesystemMockMCP;
	let cleanup: CleanupTracker;

	let githubPort: number;
	const mcpAuthToken = 'test-mcp-auth-token';
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
		process.env.ATP_JWT_SECRET = 'test-secret-key-combined-tools';
		cleanup = createCleanupTracker();

		await new Promise((resolve) => setTimeout(resolve, 500));

		githubPort = getTestPort();

		githubServer = new GitHubMockServer({ port: githubPort });
		await githubServer.start();
		cleanup.httpServers.push(githubServer);
		await new Promise((resolve) => setTimeout(resolve, 200));

		filesystemMCP = new FilesystemMockMCP({
			authToken: mcpAuthToken,
		});

		const githubSpec = replacePortInSpec(loadOpenAPISpec('github-mock'), {
			GITHUB_PORT: githubPort,
			OAUTH_PORT: 0,
		});

		const githubSpecPath = join(tmpdir(), `github-spec-combined-${Date.now()}.json`);
		writeFileSync(githubSpecPath, JSON.stringify(githubSpec));
		tempFiles.push(githubSpecPath);

		const githubApiGroup = await loadOpenAPI(githubSpecPath, {
			name: 'github',
			baseURL: `http://localhost:${githubPort}`,
			authProvider: mockAuthProvider,
		});

		const mcpFunctions: CustomFunctionDef[] = [
			{
				name: 'readFile',
				description: 'Read a file from the filesystem',
				inputSchema: {
					type: 'object',
					properties: {
						path: { type: 'string' },
					},
					required: ['path'],
				},
				handler: async (input: any) => {
					const mcpRequest = {
						jsonrpc: '2.0',
						id: 1,
						method: 'tools/call',
						params: {
							name: 'readFile',
							arguments: input,
						},
					};

					const response = await filesystemMCP.handleRequest(mcpRequest, mcpAuthToken);

					if (response.error) {
						throw new Error(response.error.message);
					}

					return response.result.content[0].text;
				},
			},
			{
				name: 'writeFile',
				description: 'Write content to a file',
				inputSchema: {
					type: 'object',
					properties: {
						path: { type: 'string' },
						content: { type: 'string' },
					},
					required: ['path', 'content'],
				},
				handler: async (input: any) => {
					const mcpRequest = {
						jsonrpc: '2.0',
						id: 1,
						method: 'tools/call',
						params: {
							name: 'writeFile',
							arguments: input,
						},
					};

					const response = await filesystemMCP.handleRequest(mcpRequest, mcpAuthToken);

					if (response.error) {
						throw new Error(response.error.message);
					}

					return { success: true, message: response.result.content[0].text };
				},
			},
		];

		const mcpApiGroup = {
			name: 'filesystem',
			type: 'mcp' as const,
			functions: mcpFunctions,
		};

		atpServer = await createTestATPServer({
			apiGroups: [githubApiGroup, mcpApiGroup],
		});

		cleanup.servers.push(atpServer);

		await filesystemMCP.handleRequest(
			{
				jsonrpc: '2.0',
				id: 0,
				method: 'initialize',
			},
			mcpAuthToken
		);
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

	it('should execute code combining OpenAPI, MCP, and Client tools', async () => {
		const clientTools: ClientTool[] = [
			{
				name: 'getSystemInfo',
				description: 'Get system information',
				inputSchema: {
					type: 'object',
					properties: {},
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async () => {
					return {
						platform: 'test-platform',
						arch: 'test-arch',
						nodeVersion: 'test-node-version',
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

		await client.init({ name: 'combined-test-client' });

		const code = `
			const githubUser = await api.github.getAuthenticatedUser();
			
			const fileContent = await api.filesystem.readFile({ path: '/test/file1.txt' });
			
			const systemInfo = await api.client.getSystemInfo({});
			
			return {
				github: { login: githubUser.login, id: githubUser.id },
				filesystem: fileContent,
				client: systemInfo
			};
		`;

		const result = await client.execute(code);

		if (result.status !== ExecutionStatus.COMPLETED) {
			console.log('Status:', result.status);
			console.log('Error:', JSON.stringify(result.error, null, 2));
		}

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.github).toBeDefined();
		expect(data.github.login).toBe('testuser');

		expect(data.filesystem).toBeDefined();

		expect(data.client).toBeDefined();
		expect(data.client.platform).toBe('test-platform');
	});

	it('should handle parallel calls across all three tool types', async () => {
		const clientTools: ClientTool[] = [
			{
				name: 'compute',
				description: 'Perform computation',
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
					return { result: input.value * 2 };
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

		await client.init({ name: 'parallel-combined-test' });

		const code = `
			const github = await api.github.listRepositories();
			const mcp = await api.filesystem.readFile({ path: '/test/file2.txt' });
			const clientTool = await api.client.compute({ value: 21 });
			
			return {
				githubRepoCount: github.length,
				mcpFileRead: !!mcp,
				clientResult: clientTool.result
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.githubRepoCount).toBeGreaterThan(0);
		expect(data.mcpFileRead).toBe(true);
		expect(data.clientResult).toBe(42);
	});

	it('should handle MCP file write and read back', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'mcp-write-read-test' });

		const code = `
			await api.filesystem.writeFile({ 
				path: '/test/new-file.txt', 
				content: 'Test content from ATP' 
			});
			
			const readBack = await api.filesystem.readFile({ path: '/test/new-file.txt' });
			
			return { readBack };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.readBack).toBeDefined();
	});

	it('should handle errors from MCP tools', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'mcp-error-test' });

		const code = `
			try {
				await api.filesystem.readFile({ path: '/nonexistent/file.txt' });
				return { error: false };
			} catch (error) {
				return { error: true, message: error.message };
			}
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.error).toBe(true);
		expect(data.message).toContain('not found');
	});

	it('should combine data from all three sources in complex workflow', async () => {
		const clientTools: ClientTool[] = [
			{
				name: 'processData',
				description: 'Process data locally',
				inputSchema: {
					type: 'object',
					properties: {
						data: { type: 'object' },
					},
					required: ['data'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async (input: any) => {
					return {
						processed: true,
						itemCount: Object.keys(input.data).length,
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

		await client.init({ name: 'complex-workflow-test' });

		const code = `
			const user = await api.github.getAuthenticatedUser();
			
			const configFile = await api.filesystem.readFile({ path: '/data/config.json' });
			const config = JSON.parse(configFile);
			
			const processed = await api.client.processData({ data: config });
			
			return {
				workflow: {
					user: user.login,
					configKeys: processed.itemCount,
					processed: processed.processed
				}
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.workflow).toBeDefined();
		expect(data.workflow.user).toBe('testuser');
		expect(data.workflow.configKeys).toBeGreaterThan(0);
		expect(data.workflow.processed).toBe(true);
	});
});
