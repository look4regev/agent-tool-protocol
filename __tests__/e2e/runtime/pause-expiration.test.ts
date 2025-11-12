/**
 * E2E Tests for Max Pause Duration and Metrics Tracking
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@agent-tool-protocol/server';
import fetch from 'node-fetch';

const TEST_PORT = 3508;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe('Max Pause Duration and Metrics', () => {
	let server: AgentToolProtocolServer;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-pause-expiration';

		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
			},
			executionState: {
				ttl: 3600, // 1 hour
				maxPauseDuration: 2, // 2 seconds for testing
			},
		});

		server.tool('testApi', {
			description: 'Test API',
			input: { value: 'string' },
			handler: async (params: any) => ({ result: params.value }),
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

	test('should track pause/resume metrics', async () => {
		const { clientId, token } = await initClient();

		// Get initial metrics
		const initialMetrics = server.stateManager!.getMetrics();
		expect(initialMetrics).toBeDefined();

		const code = `
            const data = await api.custom.testApi({ value: 'test' });
            const approval = await atp.approval.request('Continue?', {});
            return { data, approval };
        `;

		// Execute - will pause
		let response = await execute(clientId, token, code);
		expect(response.status).toBe('paused');
		const executionId = response.executionId;

		// Check metrics - should have 1 pause
		let metrics = server.stateManager!.getMetrics();
		expect(metrics.totalPauses).toBeGreaterThan(initialMetrics.totalPauses);

		// Resume
		response = await resume(clientId, token, executionId, { approved: true });
		expect(response.status).toBe('completed');

		// Check metrics - should have 1 resume
		metrics = server.stateManager!.getMetrics();
		expect(metrics.totalResumes).toBeGreaterThan(initialMetrics.totalResumes);
		expect(metrics.successRate).toBeDefined();
	});

	test('should reject expired pause after maxPauseDuration', async () => {
		const { clientId, token } = await initClient();

		const code = `
            const approval = await atp.approval.request('Wait for it...', {});
            return { approved: approval.approved };
        `;

		// Execute - will pause
		let response = await execute(clientId, token, code);
		expect(response.status).toBe('paused');
		const executionId = response.executionId;

		// Wait longer than maxPauseDuration (2 seconds)
		await new Promise((resolve) => setTimeout(resolve, 3000));

		// Try to resume - should fail (expired)
		const resumeResponse = await fetch(`${BASE_URL}/api/resume/${executionId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({ result: { approved: true } }),
		});

		// Should get 404 (execution not found/expired)
		expect(resumeResponse.status).toBe(404);

		// Check metrics - should have 1 expired
		const metrics = server.stateManager!.getMetrics();
		expect(metrics.totalExpired).toBeGreaterThan(0);
		expect(metrics.expiredRate).toBeDefined();
	});

	test('should successfully resume within maxPauseDuration', async () => {
		const { clientId, token } = await initClient();

		const code = `
            const approval = await atp.approval.request('Quick approval', {});
            return { approved: approval.approved };
        `;

		// Execute - will pause
		let response = await execute(clientId, token, code);
		expect(response.status).toBe('paused');
		const executionId = response.executionId;

		// Wait less than maxPauseDuration (1 second)
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Resume - should succeed
		response = await resume(clientId, token, executionId, { approved: true });
		expect(response.status).toBe('completed');
		expect(response.result.approved).toBe(true);
	});

	test('should provide accurate success rate metrics', async () => {
		const { clientId, token } = await initClient();

		// Reset metrics for this test
		server.stateManager!.resetMetrics();

		const code = `
            const approval = await atp.approval.request('Test', {});
            return { approved: approval.approved };
        `;

		// Execute 3 times and resume all
		for (let i = 0; i < 3; i++) {
			let response = await execute(clientId, token, code);
			expect(response.status).toBe('paused');

			response = await resume(clientId, token, response.executionId, { approved: true });
			expect(response.status).toBe('completed');
		}

		// Check metrics
		const metrics = server.stateManager!.getMetrics();
		expect(metrics.totalPauses).toBe(3);
		expect(metrics.totalResumes).toBe(3);
		expect(metrics.successRate).toBe('100.00%');
	});

	test('should track mixed success and expiration', async () => {
		server.stateManager!.resetMetrics();

		const { clientId, token } = await initClient();

		const code = `
            const approval = await atp.approval.request('Test', {});
            return { approved: approval.approved };
        `;

		// Success case
		let response = await execute(clientId, token, code);
		await resume(clientId, token, response.executionId, { approved: true });

		// Expiration case
		response = await execute(clientId, token, code);
		const expiredId = response.executionId;
		await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait for expiration

		const expiredResume = await fetch(`${BASE_URL}/api/resume/${expiredId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({ result: { approved: true } }),
		});
		expect(expiredResume.status).toBe(404);

		// Check metrics
		const metrics = server.stateManager!.getMetrics();
		expect(metrics.totalPauses).toBe(2);
		expect(metrics.totalResumes).toBe(1);
		expect(metrics.totalExpired).toBeGreaterThanOrEqual(1);

		// Success rate should be 50% (1 resume out of 2 pauses)
		expect(metrics.successRate).toBe('50.00%');
	});

	// Helper functions
	async function initClient() {
		const response = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'pause-expiration-test' } }),
		});
		return await response.json();
	}

	async function execute(clientId: string, token: string, code: string) {
		const response = await fetch(`${BASE_URL}/api/execute`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({
				code,
				config: {
					clientServices: {
						hasApproval: true,
					},
				},
			}),
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
});
