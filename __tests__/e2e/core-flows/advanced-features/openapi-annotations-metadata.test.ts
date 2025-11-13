import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { ExecutionStatus, CallbackType } from '@mondaydotcomorg/atp-protocol';
import { loadOpenAPI } from '@agent-tool-protocol/server';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	createTestATPServer,
	createCleanupTracker,
	cleanupAll,
	getTestPort,
	type TestServer,
	type CleanupTracker,
} from '../../infrastructure/test-helpers';
import { GitHubMockServer } from '../../infrastructure/mock-servers/github-mock';

describe('Phase 2: OpenAPI Annotations and Tool Metadata', () => {
	let atpServer: TestServer;
	let githubServer: GitHubMockServer;
	let cleanup: CleanupTracker;
	let githubPort: number;
	const tempFiles: string[] = [];
	let approvalRequested = false;
	let approvalDetails: any = null;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-annotations';
		cleanup = createCleanupTracker();

		await new Promise((resolve) => setTimeout(resolve, 500));

		githubPort = getTestPort();

		githubServer = new GitHubMockServer({
			port: githubPort,
		});
		await githubServer.start();
		cleanup.httpServers.push(githubServer);
		await new Promise((resolve) => setTimeout(resolve, 200));

		const githubSpec = {
			openapi: '3.0.0',
			info: { title: 'GitHub Test', version: '1.0.0' },
			servers: [{ url: `http://localhost:${githubPort}` }],
			security: [{ bearerAuth: [] }],
			components: {
				securitySchemes: {
					bearerAuth: { type: 'http', scheme: 'bearer' },
				},
			},
			paths: {
				'/user': {
					get: {
						operationId: 'getUser',
						summary: 'Get user',
						'x-sensitive': false,
						responses: { '200': { description: 'Success' } },
					},
				},
				'/repos': {
					get: {
						operationId: 'listRepos',
						summary: 'List repos',
						'x-sensitive': false,
						responses: { '200': { description: 'Success' } },
					},
				},
				'/repos/{repoId}': {
					delete: {
						operationId: 'deleteRepo',
						summary: 'Delete repository',
						'x-destructive': true,
						'x-requires-approval': true,
						'x-sensitive': true,
						parameters: [
							{
								name: 'repoId',
								in: 'path',
								required: true,
								schema: { type: 'integer' },
							},
						],
						responses: { '204': { description: 'Deleted' } },
					},
				},
			},
		};

		const githubSpecPath = join(tmpdir(), `github-spec-annotations-${Date.now()}.json`);
		writeFileSync(githubSpecPath, JSON.stringify(githubSpec));
		tempFiles.push(githubSpecPath);

		process.env.GITHUB_TEST_TOKEN = 'mock_github_token';

		const githubApiGroup = await loadOpenAPI(githubSpecPath, {
			name: 'github',
			baseURL: `http://localhost:${githubPort}`,
			annotations: {
				fromExtensions: {
					'x-destructive': 'destructive',
					'x-requires-approval': 'requiresApproval',
					'x-sensitive': 'sensitive',
				},
			},
		});

		atpServer = await createTestATPServer({
			apiGroups: [githubApiGroup],
			approvalHandler: async (request) => {
				approvalRequested = true;
				approvalDetails = request;
				return { approved: true, timestamp: Date.now() };
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

	it('should execute safe tool without approval', async () => {
		approvalRequested = false;

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'safe-tool-client' });

		const code = `
			const user = await api.github.getUser();
			return { login: user.login };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		expect(approvalRequested).toBe(false);
	});

	it('should execute read operations without approval', async () => {
		approvalRequested = false;

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'read-tool-client' });

		const code = `
			const repos = await api.github.listRepos();
			return { count: repos.length };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		expect(approvalRequested).toBe(false);
	});

	it('should successfully execute destructive tool with manual approval', async () => {
		approvalRequested = false;
		approvalDetails = null;

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
			serviceProviders: {
				approval: {
					request: async (message, context) => {
						approvalRequested = true;
						approvalDetails = { message, context };
						return { approved: true, timestamp: Date.now() };
					},
				},
			},
		});

		cleanup.clients.push(client);

		await client.init({ name: 'destructive-tool-client' });

		const code = `
			const approvalResponse = await atp.approval.request(
				'About to delete repository 1. Approve?',
				{ operation: 'delete', repoId: 1 }
			);
			
			if (approvalResponse.approved) {
				await api.github.deleteRepo({ repoId: 1 });
				return { deleted: true, approved: true };
			} else {
				return { deleted: false, approved: false };
			}
		`;

		const result = await client.execute(code);

		if (result.status !== ExecutionStatus.COMPLETED) {
			console.log('Approval pause error:', JSON.stringify(result.error, null, 2));
			console.log('Approval requested:', approvalRequested);
		}

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		expect((result.result as any).deleted).toBe(true);
		expect((result.result as any).approved).toBe(true);
		expect(approvalRequested).toBe(true);
		expect(approvalDetails).toBeDefined();
	});

	it('should fail when approval is denied for destructive tool', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
			serviceProviders: {
				approval: {
					request: async () => {
						return { approved: false, timestamp: Date.now() };
					},
				},
			},
		});

		cleanup.clients.push(client);

		await client.init({ name: 'denied-approval-client' });

		const code = `
			try {
				await api.github.deleteRepo({ repoId: 1 });
				return { deleted: true, approved: true };
			} catch (error) {
				return { deleted: false, denied: true, error: error.message };
			}
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;
		expect(data.deleted).toBe(false);
		expect(data.denied).toBe(true);
	});
});
