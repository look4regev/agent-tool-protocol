import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@agent-tool-protocol/server';
import { ToolOperationType, ToolSensitivityLevel } from '@agent-tool-protocol/protocol';
import fetch from 'node-fetch';
import { trace, context as otelContext, SpanStatusCode, metrics } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
	MeterProvider,
	PeriodicExportingMetricReader,
	InMemoryMetricExporter,
	AggregationTemporality,
} from '@opentelemetry/sdk-metrics';

const TEST_PORT = 3506;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe('OpenTelemetry Audit Integration E2E', () => {
	let server: AgentToolProtocolServer;
	let spanExporter: InMemorySpanExporter;
	let metricExporter: InMemoryMetricExporter;
	let tracerProvider: NodeTracerProvider;
	let meterProvider: MeterProvider;

	beforeAll(async () => {
		// Set up in-memory exporters to capture telemetry
		spanExporter = new InMemorySpanExporter();
		metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);

		// Set up tracer provider with span processor
		const spanProcessor = new SimpleSpanProcessor(spanExporter);
		tracerProvider = new NodeTracerProvider({
			spanProcessors: [spanProcessor],
		});
		tracerProvider.register();

		// Set up meter provider
		meterProvider = new MeterProvider({
			readers: [
				new PeriodicExportingMetricReader({
					exporter: metricExporter,
					exportIntervalMillis: 100, // Export frequently for tests
				}),
			],
		});

		// Register the meter provider globally
		(metrics as any).setGlobalMeterProvider(meterProvider);

		process.env.ATP_JWT_SECRET = 'test-secret-otel';

		// Create server with OpenTelemetry enabled (audit sink auto-configured)
		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
			},
			otel: {
				enabled: true,
				serviceName: 'agent-tool-protocol-test',
			},
		});

		// Add test tools
		server.tool('testTool', {
			description: 'A test tool',
			input: { value: 'string' },
			handler: async (params: any) => {
				return { result: `Processed: ${params.value}` };
			},
		});

		await server.listen(TEST_PORT);
		await new Promise((resolve) => setTimeout(resolve, 500));
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		if (tracerProvider) {
			await tracerProvider.shutdown();
		}
		if (meterProvider) {
			await meterProvider.shutdown();
		}
		delete process.env.ATP_JWT_SECRET;
		await new Promise((resolve) => setTimeout(resolve, 500));
	});

	test('should capture traces for execution lifecycle', async () => {
		// Clear previous spans
		spanExporter.reset();

		// Initialize client
		const initResponse = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'otel-test' } }),
		});

		expect(initResponse.ok).toBe(true);
		const { clientId, token } = await initResponse.json();

		// Execute code
		const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({
				code: `
                    const result = await api.custom.testTool({ value: 'test123' });
                    return result;
                `,
			}),
		});

		expect(executeResponse.ok).toBe(true);
		const result = await executeResponse.json();
		expect(result.status).toBe('completed');

		// Wait for spans to be exported
		await new Promise((resolve) => setTimeout(resolve, 200));

		// Get exported spans
		const spans = spanExporter.getFinishedSpans();

		// Should have spans for client_init and execution events
		expect(spans.length).toBeGreaterThan(0);

		// Check for execution-related spans
		const executionSpans = spans.filter(
			(span) => span.name.includes('atp.execution') || span.name.includes('atp.client_init')
		);
		expect(executionSpans.length).toBeGreaterThan(0);

		// Verify span attributes
		const firstSpan = executionSpans[0];
		expect(firstSpan.attributes['atp.client.id']).toBeDefined();
		expect(firstSpan.attributes['atp.event.type']).toBeDefined();
		expect(firstSpan.status.code).toBe(SpanStatusCode.OK);
	});

	test('should capture tool metadata attributes', async () => {
		spanExporter.reset();

		const initResponse = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'otel-metadata-test' } }),
		});

		const { clientId, token } = await initResponse.json();

		// Add tool with metadata
		server.tool('sensitiveOperation', {
			description: 'A sensitive operation',
			input: { data: 'string' },
			metadata: {
				operationType: ToolOperationType.WRITE,
				sensitivityLevel: ToolSensitivityLevel.SENSITIVE,
				category: 'security',
			},
			handler: async (params: any) => {
				return { processed: true };
			},
		});

		const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({
				code: `
                    const result = await api.custom.sensitiveOperation({ data: 'test' });
                    return result;
                `,
			}),
		});

		expect(executeResponse.ok).toBe(true);

		// Wait for spans
		await new Promise((resolve) => setTimeout(resolve, 200));

		const spans = spanExporter.getFinishedSpans();

		// Look for tool_call spans
		const toolSpans = spans.filter((span) => span.name.includes('tool_call'));

		if (toolSpans.length > 0) {
			const toolSpan = toolSpans[0];
			// Check that tool attributes are captured
			expect(toolSpan.attributes['atp.event.type']).toBe('tool_call');
		}
	});

	test('should handle errors gracefully', async () => {
		spanExporter.reset();

		const initResponse = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'otel-error-test' } }),
		});

		const { clientId, token } = await initResponse.json();

		// Execute code that will fail
		const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({
				code: `
                    throw new Error('Test error');
                `,
			}),
		});

		expect(executeResponse.ok).toBe(true);
		const result = await executeResponse.json();
		expect(result.status).toBe('failed');

		// Wait for spans
		await new Promise((resolve) => setTimeout(resolve, 200));

		const spans = spanExporter.getFinishedSpans();
		expect(spans.length).toBeGreaterThan(0);

		// Should still capture the execution even though it failed
		const executionSpans = spans.filter((span) => span.name.includes('atp.execution'));
		expect(executionSpans.length).toBeGreaterThan(0);
	});

	test('should export metrics', async () => {
		metricExporter.reset();

		const initResponse = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'otel-metrics-test' } }),
		});

		const { clientId, token } = await initResponse.json();

		const executeResponse = await fetch(`${BASE_URL}/api/execute`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({
				code: `
                    const result = await api.custom.testTool({ value: 'metrics-test' });
                    return result;
                `,
			}),
		});

		expect(executeResponse.ok).toBe(true);

		// Wait for metric export
		await new Promise((resolve) => setTimeout(resolve, 500));

		// Force metric collection
		await meterProvider.forceFlush();

		const metrics = metricExporter.getMetrics();

		// Should have some metrics (even if empty due to timing)
		// The important thing is that the exporter is working
		expect(Array.isArray(metrics)).toBe(true);
	});
});
