import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { ExecutionStatus, ToolOperationType } from '@agent-tool-protocol/protocol';
import type { ClientTool } from '@agent-tool-protocol/protocol';
import {
	createTestATPServer,
	createCleanupTracker,
	cleanupAll,
	type TestServer,
	type CleanupTracker,
} from '../../infrastructure/test-helpers';

describe('Phase 2: Multi-Step State Capture and Persistence', () => {
	let atpServer: TestServer;
	let cleanup: CleanupTracker;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-key-state-capture';
		cleanup = createCleanupTracker();

		await new Promise((resolve) => setTimeout(resolve, 500));

		atpServer = await createTestATPServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
			},
		});

		cleanup.servers.push(atpServer);
	});

	afterAll(async () => {
		await cleanupAll(cleanup);
	});

	it('should maintain state across multiple client tool pauses', async () => {
		let callCount = 0;

		const clientTools: ClientTool[] = [
			{
				name: 'fetchData',
				description: 'Fetch data (pauses execution)',
				inputSchema: {
					type: 'object',
					properties: {
						id: { type: 'number' },
					},
					required: ['id'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async (input: any) => {
					callCount++;
					return { id: input.id, value: input.id * 10, callNumber: callCount };
				},
			},
			{
				name: 'processData',
				description: 'Process data (pauses execution)',
				inputSchema: {
					type: 'object',
					properties: {
						data: { type: 'array' },
					},
					required: ['data'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async (input: any) => {
					callCount++;
					return {
						processed: input.data.map((item: any) => item.value * 2),
						callNumber: callCount,
					};
				},
			},
		];

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
			serviceProviders: {
				tools: clientTools,
			},
		});

		cleanup.clients.push(client);

		await client.init({ name: 'state-capture-client' });

		const code = `
			let accumulator = 0;
			const results = [];
			
			const data1 = await api.client.fetchData({ id: 1 });
			accumulator += data1.value;
			results.push(data1);
			
			const data2 = await api.client.fetchData({ id: 2 });
			accumulator += data2.value;
			results.push(data2);
			
			const data3 = await api.client.fetchData({ id: 3 });
			accumulator += data3.value;
			results.push(data3);
			
			const processed = await api.client.processData({ data: results });
			
			return {
				accumulator: accumulator,
				expectedAccumulator: 60,
				processedSum: processed.processed.reduce((a, b) => a + b, 0),
				callsMatch: processed.callNumber === 4
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.accumulator).toBe(60);
		expect(data.processedSum).toBe(120);
		expect(data.callsMatch).toBe(true);
		expect(callCount).toBe(4);
	});

	it('should preserve variables across pauses with complex data structures', async () => {
		const clientTools: ClientTool[] = [
			{
				name: 'enrichData',
				description: 'Enrich data with additional info',
				inputSchema: {
					type: 'object',
					properties: {
						item: { type: 'object' },
					},
					required: ['item'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async (input: any) => {
					return {
						...input.item,
						enriched: true,
						timestamp: Date.now(),
					};
				},
			},
		];

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
			serviceProviders: {
				tools: clientTools,
			},
		});

		cleanup.clients.push(client);

		await client.init({ name: 'complex-state-client' });

		const code = `
			const user1 = { id: 1, name: 'Alice' };
			const user2 = { id: 2, name: 'Bob' };
			const user3 = { id: 3, name: 'Charlie' };
			
			const enriched1 = await api.client.enrichData({ item: user1 });
			const enriched2 = await api.client.enrichData({ item: user2 });
			const enriched3 = await api.client.enrichData({ item: user3 });
			
			const enrichedUsers = [enriched1, enriched2, enriched3];
			
			return {
				originalCount: 3,
				enrichedCount: enrichedUsers.length,
				allEnriched: enriched1.enriched && enriched2.enriched && enriched3.enriched,
				namesPreserved: [enriched1.name, enriched2.name, enriched3.name]
			};
		`;

		const result = await client.execute(code);

		if (result.status !== ExecutionStatus.COMPLETED) {
			console.log('Complex state error:', JSON.stringify(result.error, null, 2));
		}

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.originalCount).toBe(3);
		expect(data.enrichedCount).toBe(3);
		expect(data.allEnriched).toBe(true);
		expect(data.namesPreserved).toEqual(['Alice', 'Bob', 'Charlie']);
	});

	it('should maintain execution context across LLM and client tool pauses', async () => {
		const clientTools: ClientTool[] = [
			{
				name: 'localCompute',
				description: 'Perform local computation',
				inputSchema: {
					type: 'object',
					properties: {
						value: { type: 'number' },
					},
					required: ['value'],
				},
				metadata: {
					operationType: ToolOperationType.READ,
				},
				handler: async (input: any) => {
					return { computed: input.value * input.value };
				},
			},
		];

		const client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${atpServer.port}`,
			serviceProviders: {
				tools: clientTools,
				llm: {
					call: async (prompt: string) => {
						return `Analyzed: ${prompt}`;
					},
				},
			},
		});

		cleanup.clients.push(client);

		await client.init({ name: 'mixed-pause-client' });

		const code = `
			const initialValue = 5;
			
			const computed = await api.client.localCompute({ value: initialValue });
			
			const analysis = await atp.llm.call({ prompt: 'Analyze this number: ' + computed.computed });
			
			const finalCompute = await api.client.localCompute({ value: computed.computed });
			
			const analysisStr = String(analysis);
			
			return {
				initial: initialValue,
				firstCompute: computed.computed,
				analysisLength: analysisStr.length,
				finalCompute: finalCompute.computed,
				statePreserved: initialValue === 5
			};
		`;

		const result = await client.execute(code);

		if (result.status !== ExecutionStatus.COMPLETED) {
			console.log('Mixed pause error:', JSON.stringify(result.error, null, 2));
		}

		expect(result.status).toBe(ExecutionStatus.COMPLETED);
		const data = result.result as any;

		expect(data.initial).toBe(5);
		expect(data.firstCompute).toBe(25);
		expect(data.analysisLength).toBeGreaterThan(0);
		expect(data.finalCompute).toBe(625);
		expect(data.statePreserved).toBe(true);
	});
});
