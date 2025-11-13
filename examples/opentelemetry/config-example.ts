/**
 * OpenTelemetry Configuration Example
 * Shows all available OTel configuration options
 */

import { createServer, MB, HOUR, MINUTE } from '@mondaydotcomorg/atp-server';

// Example 1: Full configuration with all options
const server1 = createServer({
	execution: {
		timeout: 30000,
		memory: 128 * MB,
		llmCalls: 10,
	},
	otel: {
		// Enable OpenTelemetry
		enabled: true,

		// Service identification
		serviceName: 'my-atp-service',
		serviceVersion: '2.1.0',

		// Exporter endpoints
		traceEndpoint: 'https://api.honeycomb.io/v1/traces',
		metricsEndpoint: 'https://api.honeycomb.io/v1/metrics',

		// Authentication headers (e.g., for Honeycomb, Datadog, etc.)
		headers: {
			'x-honeycomb-team': process.env.HONEYCOMB_API_KEY!,
		},

		// Metrics export interval (60 seconds)
		metricsInterval: 60000,

		// Additional resource attributes
		resourceAttributes: {
			'deployment.environment': 'production',
			'service.namespace': 'atp',
			'service.instance.id': process.env.HOSTNAME || 'localhost',
		},
	},
});

// Example 2: Using environment variables (OpenTelemetry standard)
// Set these environment variables:
// - OTEL_SERVICE_NAME=my-service
// - OTEL_SERVICE_VERSION=1.0.0
// - OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
// - OTEL_EXPORTER_OTLP_HEADERS="x-api-key=secret123"

const server2 = createServer({
	otel: {
		enabled: true,
		// All other values will be read from environment variables
		// Falls back to sensible defaults if not set
	},
});

// Example 3: Datadog configuration
const server3 = createServer({
	otel: {
		enabled: true,
		serviceName: 'my-atp-service',
		traceEndpoint: 'https://trace.agent.datadoghq.com/v1/traces',
		metricsEndpoint: 'https://trace.agent.datadoghq.com/v1/metrics',
		headers: {
			'DD-API-KEY': process.env.DD_API_KEY!,
		},
		resourceAttributes: {
			env: 'production',
			version: '1.0.0',
		},
	},
});

// Example 4: New Relic configuration
const server4 = createServer({
	otel: {
		enabled: true,
		serviceName: 'atp-service',
		traceEndpoint: 'https://otlp.nr-data.net:4318/v1/traces',
		metricsEndpoint: 'https://otlp.nr-data.net:4318/v1/metrics',
		headers: {
			'api-key': process.env.NEW_RELIC_LICENSE_KEY!,
		},
	},
});

// Example 5: Local Jaeger setup (default)
const server5 = createServer({
	otel: {
		enabled: true,
		// Defaults to http://localhost:4318/v1/traces and /v1/metrics
		// Perfect for local development with Jaeger
	},
});

// Example 6: AWS X-Ray configuration
const server6 = createServer({
	otel: {
		enabled: true,
		serviceName: 'atp-lambda',
		traceEndpoint: 'http://localhost:2000/v1/traces', // X-Ray daemon
		// X-Ray doesn't use metrics endpoint in the same way
	},
});

console.log('OpenTelemetry configuration examples loaded');
console.log('');
console.log('Environment variables (OpenTelemetry standard):');
console.log('  OTEL_SERVICE_NAME              - Service name');
console.log('  OTEL_SERVICE_VERSION           - Service version');
console.log('  OTEL_EXPORTER_OTLP_ENDPOINT    - Base OTLP endpoint');
console.log('  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT - Traces endpoint (overrides base)');
console.log('  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT - Metrics endpoint (overrides base)');
console.log('  OTEL_EXPORTER_OTLP_HEADERS     - Headers (format: "key1=val1,key2=val2")');
console.log('');
console.log('Supported backends:');
console.log('  ✓ Jaeger (local development)');
console.log('  ✓ Honeycomb');
console.log('  ✓ Datadog');
console.log('  ✓ New Relic');
console.log('  ✓ AWS X-Ray');
console.log('  ✓ Google Cloud Trace');
console.log('  ✓ Azure Monitor');
console.log('  ✓ Any OTLP-compatible backend');
