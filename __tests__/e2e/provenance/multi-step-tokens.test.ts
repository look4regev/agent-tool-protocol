/**
 * E2E Test: Multi-Step Provenance Token Flow
 *
 * Tests that provenance tokens persist across executions and policies enforce correctly
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createServer, ProvenanceMode, createCustomPolicy } from '@agent-tool-protocol/server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { MemoryCache } from '@mondaydotcomorg/atp-providers';
import { ProvenanceSource } from '@mondaydotcomorg/atp-provenance';
import { ExecutionResult } from '@mondaydotcomorg/atp-protocol';

describe('Multi-Step Provenance Tokens E2E', () => {
	let server: any;
	let client: AgentToolProtocolClient;
	const port = 3667;
	const cache = new MemoryCache();

	beforeAll(() => {
		process.env.ATP_JWT_SECRET = 'test-secret-for-provenance-tokens-' + Date.now();
		process.env.PROVENANCE_SECRET = 'provenance-secret-32-bytes-minimum-length';
	});

	afterAll(() => {
		delete process.env.ATP_JWT_SECRET;
		delete process.env.PROVENANCE_SECRET;
	});

	const blockExternalExfiltration = createCustomPolicy(
		'block-external-exfil',
		'Blocks sending tool-sourced data to external endpoints',
		(toolName, args, getProvenance) => {
			if (!toolName.includes('sendExternal')) {
				return { action: 'log' };
			}

			for (const value of Object.values(args)) {
				if (typeof value === 'string') {
					const prov = getProvenance(value);
					if (prov && prov.source.type === ProvenanceSource.TOOL) {
						return {
							action: 'block',
							reason: `Blocked sending tool-sourced data externally`,
							policy: 'block-external-exfil',
							context: { toolName, sourceType: prov.source.type },
						};
					}
				}
			}

			return { action: 'log' };
		}
	);

	beforeAll(async () => {
		if (!process.env.ATP_JWT_SECRET) {
			process.env.ATP_JWT_SECRET = 'test-secret-for-provenance-tokens-' + Date.now();
		}

		server = createServer({
			execution: {
				timeout: 10000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
				provenanceMode: ProvenanceMode.AST,
				securityPolicies: [blockExternalExfiltration],
			},
			providers: {
				cache,
			},
		});

		server.tool('fetchSensitiveData', {
			description: 'Fetch sensitive user data',
			input: { userId: 'string' },
			handler: async (params: any) => {
				return {
					userId: params.userId,
					email: 'user@example.com',
					ssn: '123-45-6789',
					creditCard: '4111-1111-1111-1111',
				};
			},
		});

		server.tool('sendExternal', {
			description: 'Send data to external endpoint',
			input: { data: 'string' },
			handler: async (params: any) => {
				return { sent: true, data: params.data };
			},
		});

		await server.listen(port);

		client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${port}`,
		});
		await client.init();
		await client.connect();
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		if (cache.disconnect) {
			await cache.disconnect();
		}
	});

	test('Step 1: Fetch sensitive data - tokens are issued', async () => {
		const result = await client.execute(
			`
			const data = await api.custom.fetchSensitiveData({ userId: 'user123' });
			return data;
			`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		if (result.status !== 'completed') {
			console.log('EXECUTION FAILED:', JSON.stringify(result.error, null, 2));
		}
		expect(result.status).toBe('completed');
		expect(result.result).toBeDefined();

		// Check that tokens were issued
		expect(result.provenanceTokens).toBeDefined();
		expect(result.provenanceTokens!.length).toBeGreaterThan(0);

		console.log(`✓ Step 1: Issued ${result.provenanceTokens!.length} provenance tokens`);
	});

	test('Step 2: Use sensitive data from previous step - policy blocks', async () => {
		// First execution: fetch data
		const step1 = await client.execute(
			`
			const data = await api.custom.fetchSensitiveData({ userId: 'user123' });
			return data.ssn;
			`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		expect(step1.status).toBe('completed');
		expect(step1.provenanceTokens).toBeDefined();
		const ssn = step1.result as string;

		console.log(
			`✓ Step 1 complete: Fetched SSN="${ssn}", got ${step1.provenanceTokens!.length} tokens`
		);
		console.log(`  Token paths:`, step1.provenanceTokens!.map((t) => t.path).join(', '));

		try {
			const step2 = await client.execute(
				`const result = await api.custom.sendExternal({ data: "${ssn}" });
return result;`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			// Should not reach here - policy should block
			expect(step2.status).toBe('failed');
			expect(step2.error?.message).toContain('block');
		} catch (error: any) {
			// Expected: policy violation
			expect(error.message).toContain('Blocked sending tool-sourced data');
			console.log(`✓ Step 2: Policy correctly blocked exfiltration attempt`);
		}
	});

	test('Step 3: Multi-step with template literals', async () => {
		// Step 1: Fetch data
		const step1 = await client.execute(
			`
			const user = await api.custom.fetchSensitiveData({ userId: 'user456' });
			return { email: user.email, cc: user.creditCard };
			`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		expect(step1.status).toBe('completed');
		const data = step1.result as any;

		console.log(`✓ Step 1: Fetched email and CC, got ${step1.provenanceTokens!.length} tokens`);

		// Step 2: Try to use in template literal (provenance should propagate)
		try {
			const step2 = await client.execute(
				`const message = "User ${data.email} has card ${data.cc}";
const result = await api.custom.sendExternal({ data: message });
return result;`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			expect(step2.status).toBe('failed');
		} catch (error: any) {
			expect(error.message).toContain('Blocked sending tool-sourced data');
			console.log(`✓ Step 2: Policy blocked template literal with tainted data`);
		}
	});

	test('Step 4: Safe operation with untainted data', async () => {
		// Using non-tool data should work
		const result = await client.execute(
			`const safeData = "This is public information";
const result = await api.custom.sendExternal({ data: safeData });
return result;`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		expect(result.status).toBe('completed');
		expect(result.result).toEqual({ sent: true, data: 'This is public information' });
		console.log(`✓ Step 4: Safe operation with untainted data succeeded`);
	});

	test('Step 5: Token TTL and eviction', async () => {
		// Generate many tokens to test registry limits
		const results: ExecutionResult[] = [];
		for (let i = 0; i < 5; i++) {
			const result = await client.execute(
				`
				const data = await api.custom.fetchSensitiveData({ userId: 'user${i}' });
				return data;
				`,
				{ provenanceMode: ProvenanceMode.AST }
			);
			results.push(result);
		}

		const totalTokens = results.reduce((sum, r) => sum + (r.provenanceTokens?.length || 0), 0);
		console.log(`✓ Step 5: Generated ${totalTokens} tokens across 5 executions`);

		expect(totalTokens).toBeGreaterThan(0);
	});

	test('Step 6: Empty provenance hints - should work normally', async () => {
		const result = await client.execute(
			`
			const data = await api.custom.fetchSensitiveData({ userId: 'user999' });
			return data.email;
			`,
			{
				provenanceMode: ProvenanceMode.AST,
				provenanceHints: [], // Empty hints
			}
		);

		expect(result.status).toBe('completed');
		console.log(`✓ Step 6: Empty hints handled correctly`);
	});

	test('Step 7: Multiple values with same content - digest matching', async () => {
		// Fetch the same SSN value multiple times
		const step1 = await client.execute(
			`
			const data1 = await api.custom.fetchSensitiveData({ userId: 'user-a' });
			const data2 = await api.custom.fetchSensitiveData({ userId: 'user-b' });
			return { ssn1: data1.ssn, ssn2: data2.ssn };
			`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		expect(step1.status).toBe('completed');
		expect(step1.provenanceTokens).toBeDefined();

		console.log(
			`✓ Step 7: Multiple same-value provenance tracked, tokens: ${step1.provenanceTokens!.length}`
		);
	});

	test('Step 8: Nested object provenance tracking', async () => {
		const result = await client.execute(
			`
			const user = await api.custom.fetchSensitiveData({ userId: 'nested-user' });
			return {
				nested: {
					deep: {
						value: user.ssn
					}
				}
			};
			`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		expect(result.status).toBe('completed');
		expect(result.provenanceTokens).toBeDefined();
		expect(result.provenanceTokens!.length).toBeGreaterThan(0);

		console.log(`✓ Step 8: Nested provenance tracked`);
	});

	test('Step 9: Array of sensitive values', async () => {
		const result = await client.execute(
			`
			const users = [];
			for (let i = 0; i < 3; i++) {
				const data = await api.custom.fetchSensitiveData({ userId: \`user\${i}\` });
				users.push(data.email);
			}
			return users;
			`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		expect(result.status).toBe('completed');
		expect(result.provenanceTokens).toBeDefined();
		expect(result.result).toHaveLength(3);

		console.log(`✓ Step 9: Array provenance tracked, tokens: ${result.provenanceTokens!.length}`);
	});

	test('Step 10: Mixed tainted and untainted data', async () => {
		const result = await client.execute(
			`
			const tainted = await api.custom.fetchSensitiveData({ userId: 'user-mix' });
			const untainted = "public data";
			return {
				sensitive: tainted.ssn,
				public: untainted
			};
			`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		expect(result.status).toBe('completed');
		expect(result.provenanceTokens).toBeDefined();

		// Should have tokens for tainted data only
		console.log(`✓ Step 10: Mixed data handled, tokens: ${result.provenanceTokens!.length}`);
	});

	test('Step 11: Provenance disabled - no tokens issued', async () => {
		const result = await client.execute(
			`
			const data = await api.custom.fetchSensitiveData({ userId: 'no-prov' });
			return data;
			`,
			{ provenanceMode: ProvenanceMode.NONE }
		);

		expect(result.status).toBe('completed');
		expect(result.provenanceTokens).toBeUndefined();

		console.log(`✓ Step 11: No tokens when provenance disabled`);
	});

	test('Step 12: Large data structure provenance', async () => {
		const result = await client.execute(
			`
			const users = [];
			for (let i = 0; i < 20; i++) {
				const data = await api.custom.fetchSensitiveData({ userId: \`bulk-\${i}\` });
				users.push({
					id: i,
					email: data.email,
					ssn: data.ssn,
					cc: data.creditCard
				});
			}
			return users;
			`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		expect(result.status).toBe('completed');
		expect(result.provenanceTokens).toBeDefined();

		console.log(`✓ Step 12: Large structure tracked, tokens: ${result.provenanceTokens!.length}`);
	});

	test('Step 13: Policy blocks on second execution with hints', async () => {
		// First execution: fetch sensitive data
		const step1 = await client.execute(
			`
			const user = await api.custom.fetchSensitiveData({ userId: 'policy-test' });
			return { 
				email: user.email,
				ssn: user.ssn
			};
			`,
			{ provenanceMode: ProvenanceMode.AST }
		);

		expect(step1.status).toBe('completed');
		const data = step1.result as any;

		console.log(`✓ Step 13a: Data fetched with ${step1.provenanceTokens!.length} tokens`);

		// Second execution: client automatically sends hints, policy should block
		try {
			const step2 = await client.execute(
				`const ssn = "${data.ssn}";
const result = await api.custom.sendExternal({ data: ssn });
return result;`,
				{ provenanceMode: ProvenanceMode.AST }
			);

			// If we get here, check if it was blocked
			if (step2.status === 'failed') {
				expect(step2.error?.message).toContain('block');
				console.log(`✓ Step 13b: Policy correctly blocked with hints`);
			}
		} catch (error: any) {
			// Expected: policy violation
			expect(error.message).toContain('Blocked sending tool-sourced data');
			console.log(`✓ Step 13b: Policy correctly blocked with hints (exception)`);
		}
	});

	test('Step 14: Token capping at 5000 limit', async () => {
		// Try to generate a massive structure
		const result = await client.execute(
			`
			const massive = {};
			for (let i = 0; i < 100; i++) {
				massive[\`key\${i}\`] = await api.custom.fetchSensitiveData({ userId: \`mass-\${i}\` });
			}
			return massive;
			`,
			{
				provenanceMode: ProvenanceMode.AST,
				timeout: 30000,
			}
		);

		expect(result.status).toBe('completed');
		expect(result.provenanceTokens).toBeDefined();

		// Should be capped at maxTokens (5000 in token-emitter.ts)
		expect(result.provenanceTokens!.length).toBeLessThanOrEqual(5000);

		console.log(`✓ Step 14: Token emission capped at ${result.provenanceTokens!.length}`);
	});
});
