import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@agent-tool-protocol/client';
import { ExecutionStatus, ToolOperationType } from '@agent-tool-protocol/protocol';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import {
	createTestATPServer,
	createCleanupTracker,
	cleanupAll,
	getTestPort,
	type TestServer,
	type CleanupTracker,
} from '../../infrastructure/test-helpers';

describe('Phase 2: Cascading Failures and Error Handling', () => {
	let atpServer: TestServer;
	let unreliableServer: Server | null = null;
	let cleanup: CleanupTracker;
	let unreliablePort: number;
	let requestCount = 0;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-failures';
		cleanup = createCleanupTracker();

		await new Promise((resolve) => setTimeout(resolve, 500));

		unreliablePort = getTestPort();

		unreliableServer = createServer((req: IncomingMessage, res: ServerResponse) => {
			requestCount++;

			if (req.url === '/sometimes-fails' && req.method === 'GET') {
				if (requestCount % 3 === 0) {
					res.statusCode = 500;
					res.end(JSON.stringify({ error: 'Internal server error' }));
				} else if (requestCount % 5 === 0) {
					setTimeout(() => {
						res.statusCode = 408;
						res.end(JSON.stringify({ error: 'Request timeout' }));
					}, 100);
				} else {
					res.statusCode = 200;
					res.setHeader('Content-Type', 'application/json');
					res.end(JSON.stringify({ success: true, requestNumber: requestCount }));
				}
			} else if (req.url === '/always-fails' && req.method === 'GET') {
				res.statusCode = 500;
				res.end(JSON.stringify({ error: 'Always fails' }));
			} else if (req.url === '/success' && req.method === 'GET') {
				res.statusCode = 200;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({ success: true }));
			} else {
				res.statusCode = 404;
				res.end(JSON.stringify({ error: 'Not found' }));
			}
		});

		await new Promise<void>((resolve, reject) => {
			unreliableServer!.on('error', reject);
			unreliableServer!.listen(unreliablePort, () => resolve());
		});

		const apiGroup = {
			name: 'unreliable',
			type: 'custom' as const,
			functions: [
				{
					name: 'sometimesFails',
					description: 'Endpoint that sometimes fails',
					inputSchema: {
						type: 'object',
						properties: {},
					},
					handler: async () => {
						const response = await fetch(`http://localhost:${unreliablePort}/sometimes-fails`);
						if (!response.ok) {
							throw new Error(`HTTP ${response.status}: ${await response.text()}`);
						}
						return await response.json();
					},
				},
				{
					name: 'alwaysFails',
					description: 'Endpoint that always fails',
					inputSchema: {
						type: 'object',
						properties: {},
					},
					handler: async () => {
						const response = await fetch(`http://localhost:${unreliablePort}/always-fails`);
						if (!response.ok) {
							throw new Error(`HTTP ${response.status}: ${await response.text()}`);
						}
						return await response.json();
					},
				},
				{
					name: 'success',
					description: 'Endpoint that always succeeds',
					inputSchema: {
						type: 'object',
						properties: {},
					},
					handler: async () => {
						const response = await fetch(`http://localhost:${unreliablePort}/success`);
						if (!response.ok) {
							throw new Error(`HTTP ${response.status}`);
						}
						return await response.json();
					},
				},
			],
		};

		atpServer = await createTestATPServer({
			apiGroups: [apiGroup],
		});

		cleanup.servers.push(atpServer);
	});

	afterAll(async () => {
		if (unreliableServer) {
			await new Promise<void>((resolve, reject) => {
				unreliableServer!.close((err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		}

		await cleanupAll(cleanup);
	});

	it('should handle errors with try-catch and continue execution', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'error-handling-client' });

		const code = `
			const results = {
				success: null,
				failureCaught: false,
				continueAfterError: false
			};
			
			try {
				const successResult = await api.unreliable.success();
				results.success = successResult.success;
			} catch (error) {
				results.success = false;
			}
			
			try {
				await api.unreliable.alwaysFails();
				results.failureCaught = false;
			} catch (error) {
				results.failureCaught = true;
			}
			
			results.continueAfterError = true;
			
			return results;
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.success).toBe(true);
		expect(data.failureCaught).toBe(true);
		expect(data.continueAfterError).toBe(true);
	});

	it('should implement retry logic with exponential backoff', async () => {
		requestCount = 0;

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'retry-logic-client' });

		const code = `
			async function retryWithBackoff(fn, maxRetries = 3) {
				for (let attempt = 1; attempt <= maxRetries; attempt++) {
					try {
						return await fn();
					} catch (error) {
						if (attempt === maxRetries) {
							throw error;
						}
						await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
					}
				}
			}
			
			const attempts = [];
			try {
				const result = await retryWithBackoff(async () => {
					attempts.push(1);
					return await api.unreliable.sometimesFails();
				});
				
				return {
					success: true,
					attempts: attempts.length,
					result: result
				};
			} catch (error) {
				return {
					success: false,
					attempts: attempts.length,
					error: error.message
				};
			}
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.attempts).toBeGreaterThan(0);
		expect(data.attempts).toBeLessThanOrEqual(3);
	});

	it('should handle partial success in batch operations', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'batch-partial-client' });

		const code = `
			const results = {
				successful: [],
				failed: []
			};
			
			try {
				const result1 = await api.unreliable.success();
				if (result1.success) results.successful.push(1);
			} catch (error) {
				results.failed.push(1);
			}
			
			try {
				await api.unreliable.alwaysFails();
				results.successful.push(2);
			} catch (error) {
				results.failed.push(2);
			}
			
			try {
				const result3 = await api.unreliable.success();
				if (result3.success) results.successful.push(3);
			} catch (error) {
				results.failed.push(3);
			}
			
			try {
				await api.unreliable.alwaysFails();
				results.successful.push(4);
			} catch (error) {
				results.failed.push(4);
			}
			
			try {
				const result5 = await api.unreliable.success();
				if (result5.success) results.successful.push(5);
			} catch (error) {
				results.failed.push(5);
			}
			
			return {
				successCount: results.successful.length,
				failCount: results.failed.length,
				successful: results.successful,
				failed: results.failed
			};
		`;

		const result = await client.execute(code);

		if (result.status !== ExecutionStatus.COMPLETED) {
			console.log('Batch operations error:', JSON.stringify(result.error, null, 2));
		}

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.successCount).toBe(3);
		expect(data.failCount).toBe(2);
		expect(data.successful).toEqual([1, 3, 5]);
		expect(data.failed).toEqual([2, 4]);
	});

	it('should log errors without stopping execution', async () => {
		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
		});

		cleanup.clients.push(client);

		await client.init({ name: 'error-logging-client' });

		const code = `
			const errors = [];
			let successCount = 0;
			
			for (let i = 0; i < 5; i++) {
				try {
					const result = await api.unreliable.sometimesFails();
					successCount++;
				} catch (error) {
					errors.push({
						attempt: i + 1,
						error: error.message.substring(0, 50)
					});
				}
			}
			
			return {
				totalAttempts: 5,
				successCount: successCount,
				errorCount: errors.length,
				errors: errors
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.totalAttempts).toBe(5);
		expect(data.successCount + data.errorCount).toBe(5);
		expect(data.errors.length).toBeGreaterThanOrEqual(0);
	});
});
