/**
 * Comprehensive Edge Case Tests for Production-Ready Callback History Resume
 *
 * This tests the ACTUAL production implementation (not Babel instrumentation)
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@agent-tool-protocol/server';
import fetch from 'node-fetch';

const TEST_PORT = 3507;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe('Callback History Resume - Production Edge Cases', () => {
	let server: AgentToolProtocolServer;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-callback-history';

		server = new AgentToolProtocolServer({
			execution: {
				timeout: 60000,
				memory: 128 * 1024 * 1024,
				llmCalls: 20,
			},
		});

		// Add test tools
		server
			.tool('apiCall1', {
				description: 'First API call',
				input: { value: 'string' },
				handler: async (params: any) => ({ result: `API1: ${params.value}` }),
			})
			.tool('apiCall2', {
				description: 'Second API call',
				input: { value: 'string' },
				handler: async (params: any) => ({ result: `API2: ${params.value}` }),
			})
			.tool('apiCall3', {
				description: 'Third API call',
				input: { value: 'string' },
				handler: async (params: any) => ({ result: `API3: ${params.value}` }),
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

	test('Edge Case 1: Multiple sequential pauses', async () => {
		const { clientId, token } = await initClient();

		const code = `
            const step1 = await api.custom.apiCall1({ value: 'test1' });
            const approval1 = await atp.approval.request('Step 1 done, continue?', { step: 1 });
            
            const step2 = await api.custom.apiCall2({ value: 'test2' });
            const approval2 = await atp.approval.request('Step 2 done, continue?', { step: 2 });
            
            const step3 = await api.custom.apiCall3({ value: 'test3' });
            const approval3 = await atp.approval.request('Step 3 done, continue?', { step: 3 });
            
            return { step1, step2, step3, approvals: [approval1, approval2, approval3] };
        `;

		// Execute - will pause at first approval
		let response = await execute(clientId, token, code);
		expect(response.status).toBe('paused');
		let executionId = response.executionId;

		// Resume 1
		response = await resume(clientId, token, executionId, { approved: true });
		expect(response.status).toBe('paused');

		// Resume 2
		response = await resume(clientId, token, executionId, { approved: true });
		expect(response.status).toBe('paused');

		// Resume 3 - should complete
		response = await resume(clientId, token, executionId, { approved: true });
		expect(response.status).toBe('completed');
		expect(response.result.step1).toBeDefined();
		expect(response.result.step2).toBeDefined();
		expect(response.result.step3).toBeDefined();
	});

	test('Edge Case 2: Nested approval with API calls between', async () => {
		const { clientId, token } = await initClient();

		const code = `
            const data = await api.custom.apiCall1({ value: 'initial' });
            
            const outer = await atp.approval.request('Outer approval', { data });
            if (!outer.approved) return { error: 'Outer denied' };
            
            const middle = await api.custom.apiCall2({ value: 'middle' });
            
            const inner = await atp.approval.request('Inner approval', { middle });
            if (!inner.approved) return { error: 'Inner denied' };
            
            const final = await api.custom.apiCall3({ value: 'final' });
            
            return { data, middle, final, approvals: [outer, inner] };
        `;

		let response = await execute(clientId, token, code);
		expect(response.status).toBe('paused');

		response = await resume(clientId, token, response.executionId, { approved: true });
		expect(response.status).toBe('paused');

		response = await resume(clientId, token, response.executionId, { approved: true });
		expect(response.status).toBe('completed');
		expect(response.result.final).toBeDefined();
	});

	test('Edge Case 3: Approval denial mid-flow', async () => {
		const { clientId, token } = await initClient();

		const code = `
            const step1 = await api.custom.apiCall1({ value: 'before-denial' });
            
            const approval = await atp.approval.request('Critical operation', { step1 });
            if (!approval.approved) {
                return { denied: true, reason: 'User denied', step1 };
            }
            
            // This should never execute
            const step2 = await api.custom.apiCall2({ value: 'after-approval' });
            return { step1, step2 };
        `;

		let response = await execute(clientId, token, code);
		expect(response.status).toBe('paused');

		// Deny the approval
		response = await resume(clientId, token, response.executionId, { approved: false });
		expect(response.status).toBe('completed');
		expect(response.result.denied).toBe(true);
		expect(response.result.step2).toBeUndefined();
	});

	test('Edge Case 4: Very long callback history (performance)', async () => {
		const { clientId, token } = await initClient();

		// Create code with many API calls and approvals
		const apiCalls = Array.from(
			{ length: 10 },
			(_, i) => `const result${i} = await api.custom.apiCall1({ value: 'call${i}' });`
		).join('\n');

		const approvals = Array.from(
			{ length: 10 },
			(_, i) =>
				`const approval${i} = await atp.approval.request('Step ${i}', { result: result${i} });
             if (!approval${i}.approved) return { error: 'Denied at step ${i}' };`
		).join('\n');

		const code = `
            ${apiCalls}
            ${approvals}
            return { success: true, count: 10 };
        `;

		let response = await execute(clientId, token, code);

		// Resume through all approvals
		for (let i = 0; i < 10; i++) {
			expect(response.status).toBe('paused');
			response = await resume(clientId, token, response.executionId, { approved: true });
		}

		expect(response.status).toBe('completed');
		expect(response.result.success).toBe(true);
	});

	test('Edge Case 5: Resume with invalid callback result', async () => {
		const { clientId, token } = await initClient();

		const code = `
            const approval = await atp.approval.request('Test', {});
            return { approved: approval.approved };
        `;

		let response = await execute(clientId, token, code);
		expect(response.status).toBe('paused');

		// Try to resume with invalid result (missing required field)
		response = await resume(clientId, token, response.executionId, { invalid: true } as any);

		// Should still work - the code handles whatever is provided
		expect(response.status).toBe('completed');
	});

	test('Edge Case 6: Unauthorized resume attempt', async () => {
		const { clientId: client1, token: token1 } = await initClient();
		const { clientId: client2, token: token2 } = await initClient();

		const code = `
            const approval = await atp.approval.request('Test', {});
            return { done: true };
        `;

		// Client 1 starts execution
		let response = await execute(client1, token1, code);
		expect(response.status).toBe('paused');
		const executionId = response.executionId;

		// Client 2 tries to resume (should fail)
		const resumeResponse = await fetch(`${BASE_URL}/api/resume/${executionId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token2}`,
				'X-Client-ID': client2,
			},
			body: JSON.stringify({ result: { approved: true } }),
		});

		expect(resumeResponse.status).toBe(403);
	});

	test('Edge Case 7: Complex conditional branching with pauses', async () => {
		const { clientId, token } = await initClient();

		const code = `
            const initial = await api.custom.apiCall1({ value: 'start' });
            
            const choice = await atp.approval.request('Which path?', { 
                options: ['A', 'B'] 
            });
            
            let result;
            if (choice.path === 'A') {
                const dataA = await api.custom.apiCall2({ value: 'pathA' });
                const confirmA = await atp.approval.request('Confirm A?', { dataA });
                result = { path: 'A', dataA, confirmed: confirmA.approved };
            } else {
                const dataB = await api.custom.apiCall3({ value: 'pathB' });
                const confirmB = await atp.approval.request('Confirm B?', { dataB });
                result = { path: 'B', dataB, confirmed: confirmB.approved };
            }
            
            return { initial, choice, result };
        `;

		let response = await execute(clientId, token, code);
		expect(response.status).toBe('paused');

		// Choose path A
		response = await resume(clientId, token, response.executionId, { path: 'A', approved: true });
		expect(response.status).toBe('paused');

		// Confirm path A
		response = await resume(clientId, token, response.executionId, { approved: true });
		expect(response.status).toBe('completed');
		expect(response.result.result.path).toBe('A');
	});

	test('Edge Case 8: Error during resumed execution', async () => {
		const { clientId, token } = await initClient();

		const code = `
            const step1 = await api.custom.apiCall1({ value: 'before-error' });
            
            const approval = await atp.approval.request('Continue?', { step1 });
            if (!approval.approved) return { denied: true };
            
            // This will throw an error
            throw new Error('Intentional error after resume');
        `;

		let response = await execute(clientId, token, code);
		expect(response.status).toBe('paused');

		response = await resume(clientId, token, response.executionId, { approved: true });
		expect(response.status).toBe('failed');
		expect(response.error).toBeDefined();
		expect(response.error.message).toContain('Intentional error');
	});

	test('Edge Case 9: Pause with large context data', async () => {
		const { clientId, token } = await initClient();

		const code = `
            const largeData = Array.from({ length: 1000 }, (_, i) => ({
                id: i,
                data: 'x'.repeat(100),
                nested: { more: 'data', count: i }
            }));
            
            const approval = await atp.approval.request('Process large data?', { 
                count: largeData.length,
                sample: largeData[0]
            });
            
            return { approved: approval.approved, dataSize: largeData.length };
        `;

		let response = await execute(clientId, token, code);
		expect(response.status).toBe('paused');

		response = await resume(clientId, token, response.executionId, { approved: true });
		expect(response.status).toBe('completed');
		expect(response.result.dataSize).toBe(1000);
	});

	test('Edge Case 10: Multiple resume attempts on completed execution', async () => {
		const { clientId, token } = await initClient();

		const code = `
            const approval = await atp.approval.request('One time approval', {});
            return { done: true, approved: approval.approved };
        `;

		let response = await execute(clientId, token, code);
		const executionId = response.executionId;

		// First resume - should complete
		response = await resume(clientId, token, executionId, { approved: true });
		expect(response.status).toBe('completed');

		// Try to resume again (should fail - execution is done)
		const secondResume = await fetch(`${BASE_URL}/api/resume/${executionId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({ result: { approved: true } }),
		});

		expect(secondResume.status).toBe(404); // Execution state should be cleaned up
	});

	// Helper functions
	async function initClient() {
		const response = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'edge-case-test' } }),
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
