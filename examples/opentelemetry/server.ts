import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { ToolOperationType, ToolSensitivityLevel } from '@mondaydotcomorg/atp-protocol';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

// Initialize OpenTelemetry SDK
const sdk = new NodeSDK({
	serviceName: 'agent-tool-protocol-example',
	traceExporter: new OTLPTraceExporter({
		url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
	}),
	metricReader: new PeriodicExportingMetricReader({
		exporter: new OTLPMetricExporter({
			url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/metrics',
		}),
		exportIntervalMillis: 60000, // Export every 60 seconds
	}),
	instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
console.log('OpenTelemetry SDK started');

// Graceful shutdown
process.on('SIGTERM', async () => {
	try {
		await sdk.shutdown();
		console.log('OpenTelemetry SDK shut down successfully');
	} catch (error) {
		console.error('Error shutting down OpenTelemetry SDK', error);
	} finally {
		process.exit(0);
	}
});

// Create ATP server with OpenTelemetry enabled
// OpenTelemetryAuditSink is automatically configured when otel.enabled: true
const server = new AgentToolProtocolServer({
	execution: {
		timeout: 30000,
		memory: 128 * 1024 * 1024,
		llmCalls: 10,
	},
	otel: {
		enabled: true,
		serviceName: 'agent-tool-protocol-example',
	},
});

// Add example tools
server
	.tool('getUser', {
		description: 'Gets a user by ID',
		input: { userId: 'string' },
		handler: async (params: any) => {
			return {
				id: params.userId,
				name: 'John Doe',
				email: 'john@example.com',
			};
		},
	})
	.tool('updateUser', {
		description: 'Updates user information',
		input: {
			userId: 'string',
			name: 'string',
		},
		metadata: {
			operationType: ToolOperationType.WRITE,
			sensitivityLevel: ToolSensitivityLevel.INTERNAL,
			category: 'user-management',
		},
		handler: async (params: any) => {
			return {
				success: true,
				userId: params.userId,
				name: params.name,
			};
		},
	})
	.tool('deleteUser', {
		description: 'Permanently deletes a user',
		input: { userId: 'string' },
		metadata: {
			operationType: ToolOperationType.DESTRUCTIVE,
			sensitivityLevel: ToolSensitivityLevel.SENSITIVE,
			requiresApproval: true,
			category: 'user-management',
			impactDescription: 'PERMANENT: Deletes user and all associated data',
		},
		handler: async (params: any) => {
			return { success: true, deletedUserId: params.userId };
		},
	});

// Start server
async function main() {
	await server.listen(3000);
	console.log('ATP server listening on http://localhost:3000');
	console.log('OpenTelemetry auditing enabled');
	console.log('');
	console.log('Metrics:');
	console.log('  - atp.executions.total: Total executions');
	console.log('  - atp.tools.calls: Tool call count');
	console.log('  - atp.llm.calls: LLM call count');
	console.log('  - atp.approvals.total: Approval requests');
	console.log('  - atp.execution.duration: Execution duration histogram');
	console.log('  - atp.tool.duration: Tool duration histogram');
	console.log('');
	console.log('Traces:');
	console.log('  - atp.execution.*: Execution traces');
	console.log('  - atp.tool_call.*: Tool call traces');
	console.log('  - atp.approval.*: Approval traces');
	console.log('');
	console.log('View traces at: http://localhost:16686 (Jaeger UI)');
}

main().catch(console.error);
