/**
 * E2E tests for complex resume scenarios with state capture
 * Tests actual pause and resume with multiple API calls and state preservation
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@agent-tool-protocol/server';
import fetch from 'node-fetch';

const TEST_PORT = 3505;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe('Complex Resume with State Capture E2E', () => {
	let server: AgentToolProtocolServer;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-resume-complex';

		// Create server with test tools that simulate API calls and pauses
		server = new AgentToolProtocolServer({
			execution: {
				timeout: 60000,
				memory: 128 * 1024 * 1024,
				llmCalls: 20,
			},
		});

		// NOTE: We do NOT configure an approval handler here
		// because we want the execution to pause and return control to the test
		// The test will provide approval responses via the resume endpoint

		// Register test APIs that will be used in the resume scenario
		server
			.tool('fetchUserData', {
				description: 'Fetches user data (simulates API call 1)',
				input: {
					userId: 'string',
				},
				handler: async (params: any) => {
					return {
						userId: params.userId,
						name: 'Test User',
						email: 'test@example.com',
					};
				},
			})
			.tool('fetchOrders', {
				description: 'Fetches user orders (simulates API call 2)',
				input: {
					userId: 'string',
				},
				handler: async (params: any) => {
					return {
						orders: [
							{ id: '1', total: 100 },
							{ id: '2', total: 200 },
						],
					};
				},
			})
			.tool('calculateTotal', {
				description: 'Calculates total from orders (simulates API call 3)',
				input: {
					orders: 'array',
				},
				handler: async (params: any) => {
					const total = params.orders.reduce((sum: number, order: any) => sum + order.total, 0);
					return { total };
				},
			})
			.tool('sendNotification', {
				description: 'Sends notification (simulates API call 4)',
				input: {
					userId: 'string',
					message: 'string',
				},
				handler: async (params: any) => {
					return { sent: true, messageId: 'msg-123' };
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

	test('should handle complex scenario: fetch user → fetch orders → PAUSE → calculate → send notification → PAUSE → resume', async () => {
		// Initialize client
		const initResponse = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'resume-test' } }),
		});

		expect(initResponse.ok).toBe(true);
		const { clientId, token } = await initResponse.json();

		// Execute code that:
		// 1. Calls fetchUserData API
		// 2. Calls fetchOrders API
		// 3. Pauses (approval.request)
		// 4. Calls calculateTotal API
		// 5. Calls sendNotification API
		// 6. Pauses again
		const code = `
			// Step 1: Fetch user data
			const userData = await api.custom.fetchUserData({ userId: 'user-123' });
			console.log('User data:', userData);
			
			// Step 2: Fetch orders
			const ordersData = await api.custom.fetchOrders({ userId: userData.userId });
			console.log('Orders:', ordersData);
			
			// Step 3: Pause for approval
			const approval1 = await atp.approval.request('Approve calculation?', {
				action: 'calculate',
				orders: ordersData.orders
			});
			
			if (!approval1.approved) {
				return { error: 'Calculation not approved' };
			}
			
			// Step 4: Calculate total
			const totalData = await api.custom.calculateTotal({ orders: ordersData.orders });
			console.log('Total:', totalData);
			
			// Step 5: Send notification
			const notification = await api.custom.sendNotification({
				userId: userData.userId,
				message: 'Your order total is ' + totalData.total
			});
			console.log('Notification:', notification);
			
			// Step 6: Pause again for final approval
			const approval2 = await atp.approval.request('Everything done. Confirm completion?', {
				action: 'complete',
				notification: notification
			});
			
			return {
				success: true,
				userData,
				ordersData,
				totalData,
				notification,
				approvals: [approval1, approval2]
			};
		`;

		// Start execution - will pause at first approval
		const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
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
						hasApproval: true, // Enable approval pause
					},
				},
			}),
		});

		expect(executeResponse.ok).toBe(true);
		const executeResult = await executeResponse.json();

		// Should be paused for approval
		expect(executeResult.status).toBe('paused'); // Use status instead of paused
		expect(executeResult.needsCallback).toBeDefined();
		expect(executeResult.needsCallback.payload.message).toContain('Approve calculation');

		const executionId = executeResult.executionId;

		// Resume with approval - should continue to second pause
		const resume1Response = await fetch(`${BASE_URL}/api/resume/${executionId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({
				result: { approved: true }, // Provide approval response
			}),
		});

		expect(resume1Response.ok).toBe(true);
		const resume1Result = await resume1Response.json();

		// Should be paused again for second approval
		expect(resume1Result.status).toBe('paused'); // Use status instead of paused
		expect(resume1Result.needsCallback).toBeDefined();
		expect(resume1Result.needsCallback.payload.message).toContain('Everything done');

		// Resume with final approval - should complete
		const resume2Response = await fetch(`${BASE_URL}/api/resume/${executionId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({
				result: { approved: true }, // Provide final approval
			}),
		});

		expect(resume2Response.ok).toBe(true);
		const finalResult = await resume2Response.json();

		// Should be completed
		expect(finalResult.status).not.toBe('paused'); // Check not paused
		expect(finalResult.result).toBeDefined();
		expect(finalResult.result.success).toBe(true);

		// Verify all API calls were made and state was preserved
		expect(finalResult.result.userData).toBeDefined();
		expect(finalResult.result.userData.userId).toBe('user-123');
		expect(finalResult.result.ordersData).toBeDefined();
		expect(finalResult.result.ordersData.orders.length).toBe(2);
		expect(finalResult.result.totalData).toBeDefined();
		expect(finalResult.result.totalData.total).toBe(300); // 100 + 200
		expect(finalResult.result.notification).toBeDefined();
		expect(finalResult.result.notification.sent).toBe(true);
	});

	test('should verify state is preserved across resume (simplified test)', async () => {
		// Initialize client
		const initResponse = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'state-test' } }),
		});

		const { clientId, token } = await initResponse.json();

		// Simple code that sets variables before pause
		const code = `
			const step1 = 'completed';
			const data = { value: 42 };
			
			const approval = await atp.approval.request('Continue?', { step: 1 });
			
			// These should be preserved after resume
			return { step1, data, approved: approval.approved };
		`;

		// Execute with client services enabled to trigger pause
		const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
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
						hasApproval: true, // Enable approval pause
					},
				},
			}),
		});

		const executeResult = await executeResponse.json();
		console.log('[TEST] Execute result:', JSON.stringify(executeResult, null, 2));
		expect(executeResult.status).toBe('paused'); // Check status instead of paused field

		// Resume with approval
		const resumeResponse = await fetch(`${BASE_URL}/api/resume/${executeResult.executionId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({
				result: { approved: true }, // Provide approval response
			}),
		});

		const finalResult = await resumeResponse.json();

		// Verify variables were preserved
		expect(finalResult.result.step1).toBe('completed');
		expect(finalResult.result.data).toEqual({ value: 42 });
		expect(finalResult.result.approved).toBe(true);
	});
});
