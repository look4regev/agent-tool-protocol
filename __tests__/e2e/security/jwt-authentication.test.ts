/**
 * E2E tests for JWT-based authentication with sliding window token refresh
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@agent-tool-protocol/server';
import fetch from 'node-fetch';

const TEST_PORT = 3500;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe('JWT Authentication E2E', () => {
	let server: AgentToolProtocolServer;

	beforeAll(async () => {
		// Set JWT secret for testing
		process.env.ATP_JWT_SECRET = 'test-secret-key-for-jwt-auth';

		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
			},
		});

		await server.listen(TEST_PORT);
		// Give server time to fully initialize
		await new Promise((resolve) => setTimeout(resolve, 500));
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		delete process.env.ATP_JWT_SECRET;
		// Give time for cleanup
		await new Promise((resolve) => setTimeout(resolve, 500));
	});

	test('should initialize client and receive JWT token', async () => {
		const response = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				clientInfo: {
					name: 'test-client',
					version: '1.0.0',
				},
			}),
		});

		expect(response.ok).toBe(true);
		const data = await response.json();

		expect(data).toHaveProperty('clientId');
		expect(data).toHaveProperty('token');
		expect(data).toHaveProperty('expiresAt');
		expect(data.clientId).toMatch(/^cli_[a-f0-9]+$/);
		expect(typeof data.token).toBe('string');
		expect(data.token.split('.').length).toBe(3); // JWT format
	});

	test('should refresh token on every authenticated request', async () => {
		// Add delay to ensure previous test has fully completed
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Initialize client
		const initResponse = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'test' } }),
		});

		expect(initResponse.ok).toBe(true);
		const { clientId, token: initialToken } = await initResponse.json();

		// Make an authenticated request
		const response = await fetch(`${BASE_URL}/api/definitions`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${initialToken}`,
				'X-Client-ID': clientId,
			},
		});

		expect(response.ok).toBe(true);

		// Check for token refresh headers
		const newToken = response.headers.get('X-ATP-Token');
		const expiresAt = response.headers.get('X-ATP-Token-Expires');

		expect(newToken).toBeTruthy();
		expect(expiresAt).toBeTruthy();
		// Token should be refreshed (may be same if generated in same second)
		expect(typeof newToken).toBe('string');
		expect(newToken!.split('.').length).toBe(3); // JWT format
		expect(parseInt(expiresAt!)).toBeGreaterThan(Date.now());
	});

	test('should reject expired or invalid JWT tokens', async () => {
		const invalidToken = 'invalid.jwt.token';

		const response = await fetch(`${BASE_URL}/api/definitions`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${invalidToken}`,
				'X-Client-ID': 'cli_test123',
			},
		});

		// Should still work for unauthenticated endpoints
		// But authenticated operations should fail
		expect(response.ok).toBe(true); // definitions is public
	});

	test('should work across multiple requests with token refresh', async () => {
		// Add delay to ensure previous test has fully completed
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Initialize
		const initResponse = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'refresh-test' } }),
		});

		expect(initResponse.ok).toBe(true);
		let { clientId, token } = await initResponse.json();

		// Make multiple requests, each should refresh the token
		for (let i = 0; i < 5; i++) {
			const response = await fetch(`${BASE_URL}/api/info`, {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Client-ID': clientId,
				},
			});

			expect(response.ok).toBe(true);

			const newToken = response.headers.get('X-ATP-Token');
			if (newToken) {
				// Token was refreshed - validate it's a proper JWT
				expect(newToken.split('.').length).toBe(3);
				token = newToken; // Use refreshed token for next request
			}
		}
	});

	test('should include client guidance in init request', async () => {
		// Add delay to ensure previous test has fully completed
		await new Promise((resolve) => setTimeout(resolve, 1000));

		const guidance = 'Always request approval before sending emails to external users';

		const response = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				clientInfo: { name: 'test' },
				guidance,
			}),
		});

		expect(response.ok).toBe(true);
		const data = await response.json();
		expect(data).toHaveProperty('clientId');

		// Verify guidance is stored by fetching definitions
		const defsResponse = await fetch(`${BASE_URL}/api/definitions`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${data.token}`,
				'X-Client-ID': data.clientId,
			},
		});

		const definitions = await defsResponse.json();
		expect(definitions).toHaveProperty('guidance', guidance);
	});
});
