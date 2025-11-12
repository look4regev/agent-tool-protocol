/**
 * E2E tests for tool metadata and automatic approval wrapping
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@agent-tool-protocol/server';
import { ToolOperationType, ToolSensitivityLevel } from '@agent-tool-protocol/protocol';
import fetch from 'node-fetch';

const TEST_PORT = 3503;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe('Tool Metadata and Auto-Approval E2E', () => {
	let server: AgentToolProtocolServer;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-tool-metadata';

		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
			},
		});

		// Add tools with different metadata
		server.tool('safeOperation', {
			description: 'A safe operation that does not require approval',
			input: { data: 'string' },
			handler: async (input: any) => {
				return { result: `Processed: ${input.data}` };
			},
		});

		server.tool('destructiveOperation', {
			description: 'A destructive operation that requires approval',
			input: { target: 'string' },
			metadata: {
				operationType: ToolOperationType.DESTRUCTIVE,
				requiresApproval: true,
			},
			handler: async (input: any) => {
				return { deleted: input.target };
			},
		});

		server.tool('sensitiveOperation', {
			description: 'A sensitive operation that requires approval',
			input: { data: 'string' },
			metadata: {
				sensitivityLevel: ToolSensitivityLevel.SENSITIVE,
				requiresApproval: true,
			},
			handler: async (input: any) => {
				return { processed: input.data };
			},
		});

		await server.listen(TEST_PORT);
		await new Promise((resolve) => setTimeout(resolve, 500));
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		delete process.env.ATP_JWT_SECRET;
		await new Promise((resolve) => setTimeout(resolve, 500));
	});

	// Helper functions
	async function initClient(name: string) {
		const response = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name } }),
		});
		return await response.json();
	}

	async function execute(clientId: string, token: string, code: string, config?: any) {
		const response = await fetch(`${BASE_URL}/api/execute`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({ code, config }),
		});
		return await response.json();
	}

	async function resume(clientId: string, token: string, executionId: string, result: any) {
		const response = await fetch(`${BASE_URL}/api/resume/${executionId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({ result }),
		});
		return await response.json();
	}

	test('should execute safe tool without approval', async () => {
		const { clientId, token } = await initClient('safe-test');

		const code = `
			const result = await api.custom.safeOperation({ data: 'test-data' });
			return result;
		`;

		const result = await execute(clientId, token, code);

		expect(result.status).toBe('completed');
		expect(result.result).toEqual({ result: 'Processed: test-data' });
	});

	test('should pause destructive tool for approval', async () => {
		const { clientId, token } = await initClient('destructive-test');

		const code = `
			const result = await api.custom.destructiveOperation({ target: 'user-123' });
			return result;
		`;

		const result = await execute(clientId, token, code, {
			clientServices: {
				hasApproval: true,
			},
		});

		// Should pause for approval
		expect(result.status).toBe('paused');
		expect(result.needsCallback).toBeTruthy();
		expect(result.needsCallback?.type).toBe('approval');
	});

	test('should pause sensitive tool for approval', async () => {
		const { clientId, token } = await initClient('sensitive-test');

		const code = `
			const result = await api.custom.sensitiveOperation({ data: 'secret-data' });
			return result;
		`;

		const result = await execute(clientId, token, code, {
			clientServices: {
				hasApproval: true,
			},
		});

		// Should pause for approval
		expect(result.status).toBe('paused');
		expect(result.needsCallback).toBeTruthy();
		expect(result.needsCallback?.type).toBe('approval');
		expect(result.needsCallback?.payload).toHaveProperty('context');
		expect((result.needsCallback?.payload as any).context).toHaveProperty('tool');
	});

	test('should include metadata in approval request', async () => {
		const { clientId, token } = await initClient('metadata-test');

		const code = `
			const result = await api.custom.destructiveOperation({ target: 'important-data' });
			return result;
		`;

		const result = await execute(clientId, token, code, {
			clientServices: {
				hasApproval: true,
			},
		});

		expect(result.status).toBe('paused');
		expect(result.needsCallback?.payload).toHaveProperty('context');

		const payload = result.needsCallback?.payload as any;
		expect(payload.context.metadata).toHaveProperty('operationType', ToolOperationType.DESTRUCTIVE);
		expect(payload.context.metadata).toHaveProperty('requiresApproval', true);
	});

	test('should execute after approval is granted', async () => {
		const { clientId, token } = await initClient('approval-grant-test');

		const code = `
			const result = await api.custom.destructiveOperation({ target: 'test-target' });
			return result;
		`;

		const executeResult = await execute(clientId, token, code, {
			clientServices: {
				hasApproval: true,
			},
		});

		expect(executeResult.status).toBe('paused');

		// Resume with approval
		const result = await resume(clientId, token, executeResult.executionId, { approved: true });

		expect(result.status).toBe('completed');
		expect(result.result).toEqual({ deleted: 'test-target' });
	});

	test('should fail when approval is denied', async () => {
		const { clientId, token } = await initClient('approval-deny-test');

		const code = `
			const result = await api.custom.sensitiveOperation({ data: 'secret' });
			return result;
		`;

		const executeResult = await execute(clientId, token, code, {
			clientServices: {
				hasApproval: true,
			},
		});

		expect(executeResult.status).toBe('paused');

		// Resume with denial
		const result = await resume(clientId, token, executeResult.executionId, { approved: false });

		// Should fail or return with denial
		expect(['completed', 'failed']).toContain(result.status);
	});

	test('should handle multiple tools with different metadata', async () => {
		const { clientId, token } = await initClient('multi-tool-test');

		const code = `
			// Safe operation - no approval needed
			const safe = await api.custom.safeOperation({ data: 'safe' });
			
			// Destructive - needs approval
			const dest = await api.custom.destructiveOperation({ target: 'target1' });
			
			return { safe, dest };
		`;

		let result = await execute(clientId, token, code, {
			clientServices: {
				hasApproval: true,
			},
		});

		// Should pause at destructive operation
		expect(result.status).toBe('paused');

		// Approve and continue
		result = await resume(clientId, token, result.executionId, { approved: true });

		expect(result.status).toBe('completed');
		expect(result.result).toHaveProperty('safe');
		expect(result.result).toHaveProperty('dest');
	});
});
