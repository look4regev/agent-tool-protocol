import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createServer, type AgentToolProtocolServer } from '@agent-tool-protocol/server';
import type { AuditSink, AuditEvent } from '@mondaydotcomorg/atp-protocol';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';

describe('Validation and Security E2E', () => {
	let server: AgentToolProtocolServer;
	let client: AgentToolProtocolClient;
	const port = 3456;

	beforeAll(() => {
		process.env.ATP_JWT_SECRET = 'test-secret-for-validation-security-tests';
	});

	afterAll(() => {
		delete process.env.ATP_JWT_SECRET;
	});

	describe('1. Audit Config Separation from OpenTelemetry', () => {
		it('should auto-configure OpenTelemetry audit sink when OTel is enabled', async () => {
			const server = createServer({
				otel: {
					enabled: true,
					serviceName: 'test-service',
				},
			});

			// OTel enabled should auto-configure OpenTelemetryAuditSink
			expect(server.auditSink).toBeDefined();
			expect(server.auditSink?.name).toBe('opentelemetry');
		});

		it('should allow custom audit sinks to override OTel auto-configuration', async () => {
			const mockAuditSink: AuditSink = {
				name: 'test-audit',
				write: async (event: AuditEvent) => {},
				writeBatch: async (events: AuditEvent[]) => {},
			};

			const server = createServer({
				audit: {
					enabled: true,
					sinks: mockAuditSink,
				},
				otel: {
					enabled: true,
					serviceName: 'test-service',
				},
			});

			// Custom sink should take precedence
			expect(server.auditSink).toBeDefined();
			expect(server.auditSink?.name).toBe('test-audit');
		});

		it('should support multiple audit sinks', async () => {
			const events: AuditEvent[] = [];

			const sink1: AuditSink = {
				name: 'sink1',
				write: async (event: AuditEvent) => {
					events.push({ ...event, source: 'sink1' } as any);
				},
				writeBatch: async (e: AuditEvent[]) => {},
			};

			const sink2: AuditSink = {
				name: 'sink2',
				write: async (event: AuditEvent) => {
					events.push({ ...event, source: 'sink2' } as any);
				},
				writeBatch: async (e: AuditEvent[]) => {},
			};

			const server = createServer({
				audit: {
					enabled: true,
					sinks: [sink1, sink2],
				},
			});

			expect(server.auditSink).toBeDefined();
			expect(server.auditSink?.name).toBe('multi');
		});
	});

	describe('2. Middleware Injection Prevention', () => {
		it('should allow middleware registration before server starts', () => {
			const server = createServer();
			const middleware = async (ctx: any, next: any) => {
				await next();
			};

			expect(() => server.use(middleware)).not.toThrow();
		});

		it('should prevent middleware injection after listen()', async () => {
			const server = createServer();
			const port = 3457;

			await server.listen(port);

			const maliciousMiddleware = async (ctx: any, next: any) => {
				ctx.responseBody = { hacked: true };
			};

			expect(() => server.use(maliciousMiddleware)).toThrow(
				/Cannot add middleware.*after server has started/
			);

			await server.stop();
		});

		it('should prevent middleware injection after handler()', async () => {
			const testServer = createServer();

			testServer.use({
				name: 'test',
				type: 'custom',
				functions: [],
			});

			await testServer.listen(3458);

			const handler = testServer.handler();
			expect(handler).toBeDefined();

			const maliciousMiddleware = async (ctx: any, next: any) => {
				ctx.responseBody = { hacked: true };
			};

			expect(() => testServer.use(maliciousMiddleware)).toThrow(
				/Cannot add middleware.*after server has started/
			);

			await testServer.stop();
		});
	});

	describe('3. Hierarchical Group Names', () => {
		beforeAll(async () => {
			server = createServer();

			// Flat group
			server.use({
				name: 'simple',
				type: 'custom',
				functions: [
					{
						name: 'hello',
						description: 'Say hello',
						inputSchema: { type: 'object', properties: {} },
						handler: async () => ({ message: 'hello from simple' }),
					},
				],
			});

			// Hierarchical group: github/readOnly
			server.use({
				name: 'github/readOnly',
				type: 'custom',
				functions: [
					{
						name: 'getUser',
						description: 'Get GitHub user',
						inputSchema: {
							type: 'object',
							properties: { username: { type: 'string' } },
							required: ['username'],
						},
						handler: async (input: any) => ({
							username: input.username,
							from: 'github/readOnly',
						}),
					},
				],
			});

			// Hierarchical group: github/write
			server.use({
				name: 'github/write',
				type: 'custom',
				functions: [
					{
						name: 'createRepo',
						description: 'Create repository',
						inputSchema: {
							type: 'object',
							properties: { name: { type: 'string' } },
							required: ['name'],
						},
						handler: async (input: any) => ({
							name: input.name,
							from: 'github/write',
						}),
					},
				],
			});

			// Deeply nested: api/v2/admin/users
			server.use({
				name: 'api/v2/admin/users',
				type: 'custom',
				functions: [
					{
						name: 'list',
						description: 'List users',
						inputSchema: { type: 'object', properties: {} },
						handler: async () => ({ users: [], from: 'api/v2/admin/users' }),
					},
				],
			});

			await server.listen(port);
			client = new AgentToolProtocolClient({ baseUrl: `http://localhost:${port}` });
			await client.init();
		});

		afterAll(async () => {
			await server.stop();
		});

		it('should execute function from flat group', async () => {
			const code = `
				const result = await api.simple.hello();
				return result;
			`;

			const result = await client.execute(code);
			expect(result.status).toBe('completed');
			expect(result.result).toEqual({ message: 'hello from simple' });
		});

		it('should execute function from 2-level hierarchical group', async () => {
			const code = `
				const result = await api.github.readOnly.getUser({ username: 'octocat' });
				return result;
			`;

			const result = await client.execute(code);
			if (result.status !== 'completed') {
				console.error('Hierarchical group test failed:', JSON.stringify(result, null, 2));
			}
			expect(result.status).toBe('completed');
			expect(result.result).toEqual({
				username: 'octocat',
				from: 'github/readOnly',
			});
		});

		it('should separate different hierarchical paths (readOnly vs write)', async () => {
			const code = `
				const readResult = await api.github.readOnly.getUser({ username: 'test' });
				const writeResult = await api.github.write.createRepo({ name: 'my-repo' });
				return { readResult, writeResult };
			`;

			const result = await client.execute(code);
			expect(result.status).toBe('completed');
			expect(result.result).toEqual({
				readResult: { username: 'test', from: 'github/readOnly' },
				writeResult: { name: 'my-repo', from: 'github/write' },
			});
		});

		it('should support deeply nested hierarchies', async () => {
			const code = `
				const result = await api.api.v2.admin.users.list();
				return result;
			`;

			const result = await client.execute(code);
			expect(result.status).toBe('completed');
			expect(result.result).toEqual({ users: [], from: 'api/v2/admin/users' });
		});
	});

	describe('4. AST-Based Import Validation', () => {
		let validationServer: AgentToolProtocolServer;
		let validationClient: AgentToolProtocolClient;
		const validationPort = 3459;

		beforeAll(async () => {
			validationServer = createServer();
			validationServer.use({
				name: 'test',
				type: 'custom',
				functions: [
					{
						name: 'dummy',
						description: 'Dummy function',
						inputSchema: { type: 'object', properties: {} },
						handler: async () => ({ ok: true }),
					},
				],
			});
			await validationServer.listen(validationPort);
			validationClient = new AgentToolProtocolClient({
				baseUrl: `http://localhost:${validationPort}`,
			});
			await validationClient.init();
		});

		afterAll(async () => {
			await validationServer?.stop();
		});

		it('should block ALL imports including @mondaydotcomorg/atp-runtime', async () => {
			const code = `
				import { atp } from '@mondaydotcomorg/atp-runtime';
				return { ok: true };
			`;

			const result = await validationClient.execute(code);
			// Should fail - either validation catches it or execution fails
			expect(['security_violation', 'failed']).toContain(result.status);
			expect(result.error).toBeDefined();
			// If it's a security violation, check the message
			if (result.status === 'security_violation') {
				expect(result.error?.context?.securityIssues).toBeDefined();
				expect(result.error?.context?.securityIssues?.[0]?.issue).toContain(
					'All imports are blocked'
				);
			}
		});

		it('should prevent imports from executing (sandbox blocks them)', async () => {
			const code = `
				import { something } from './relative-file';
				return { ok: true };
			`;

			const result = await validationClient.execute(code);
			// Imports are blocked at execution (sandbox doesn't support modules)
			expect(result.status).toBe('failed');
			expect(result.error).toBeDefined();
		});

		it('should prevent npm imports from executing (sandbox blocks them)', async () => {
			const code = `
				import axios from 'axios';
				return { ok: true };
			`;

			const result = await validationClient.execute(code);
			// Imports are blocked at execution (sandbox doesn't support modules)
			expect(result.status).toBe('failed');
			expect(result.error).toBeDefined();
		});

		it('should prevent dynamic imports from executing (sandbox blocks them)', async () => {
			const code = `
				const module = await import('fs');
				return { ok: true };
			`;

			const result = await validationClient.execute(code);
			// Dynamic imports are blocked at execution
			expect(result.status).toBe('failed');
			expect(result.error).toBeDefined();
		});

		it('should block re-exports from unauthorized modules', async () => {
			const code = `
				export * from 'dangerous-module';
			`;

			const result = await validationClient.execute(code);
			// export statements cause parse errors in the validator, which is acceptable
			expect(['security_violation', 'parse_error']).toContain(result.status);
		});

		it('should prevent require() from executing (sandbox blocks it)', async () => {
			const code = `
				const fs = require('fs');
				return { ok: true };
			`;

			const result = await validationClient.execute(code);
			// require() is not defined in the sandbox
			expect(result.status).toBe('failed');
			expect(result.error?.message).toContain('require is not defined');
		});

		it('should prevent process access (sandbox blocks it)', async () => {
			const code = `
				const env = process.env;
				return { ok: true };
			`;

			const result = await validationClient.execute(code);
			// process is not defined in the sandbox
			expect(result.status).toBe('failed');
			expect(result.error?.message).toContain('process is not defined');
		});

		it('should allow setTimeout (provided by sandbox)', async () => {
			const code = `
				setTimeout(() => {}, 1000);
				return { ok: true };
			`;

			const result = await validationClient.execute(code);
			// setTimeout is provided by the sandbox and is safe
			expect(result.status).toBe('completed');
		});

		it('should allow globalThis (sandbox provides safe globals)', async () => {
			const code = `
				// globalThis exists but doesn't have dangerous Node.js globals
				const hasProcess = typeof globalThis.process !== 'undefined';
				return { hasProcess };
			`;

			const result = await validationClient.execute(code);
			// globalThis is safe in the sandbox
			expect(result.status).toBe('completed');
			expect(result.result).toEqual({ hasProcess: false });
		});
	});
});
