# OpenTelemetry Integration Example

This example demonstrates how to integrate OpenTelemetry with the Agent Tool Protocol server for comprehensive observability (tracing, metrics, and logs).

## Prerequisites

1. Install dependencies:

```bash
yarn install
```

2. Start Jaeger (for local testing):

```bash
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

## Running the Example

```bash
# Start the server
yarn tsx server.ts
```

## What You'll See

### Traces (http://localhost:16686)

- **Distributed Tracing**: See complete execution flow from start to finish
- **Pause/Resume**: Track executions across pauses and resumes
- **Tool Calls**: Detailed traces for every tool execution
- **Approval Workflows**: Track approval requests and responses

Example trace:

```
Execution Start
  ├─ Tool Call: getUser
  ├─ Tool Call: updateUser
  ├─ Approval Request
  ├─ [PAUSED - waiting for approval]
  ├─ [RESUMED - approval granted]
  ├─ Tool Call: deleteUser
  └─ Execution Complete
```

### Metrics (Prometheus format)

Query these metrics:

```promql
# Execution rate
rate(atp_executions_total[5m])

# Tool call rate by tool name
rate(atp_tools_calls[5m]) by (tool_name)

# P95 execution duration
histogram_quantile(0.95, atp_execution_duration_bucket)

# Failed executions
sum(atp_executions_total{status="failed"})

# Approval requests
atp_approvals_total
```

### Attributes Captured

Every trace includes:

- `atp.client.id`: Client identifier
- `atp.event.type`: Event type (execution, tool_call, etc.)
- `atp.event.action`: Action (start, complete, pause, resume)
- `atp.tool.name`: Tool name for tool_call events
- `atp.tool.operation_type`: Tool operation type (read/write/destructive)
- `atp.tool.sensitivity_level`: Sensitivity level (public/internal/sensitive)
- `atp.duration_ms`: Duration in milliseconds
- `atp.status`: Execution status
- `atp.security.risk_score`: Risk score (if applicable)
- `atp.security.events`: Security events detected

## Testing with Client

```typescript
import fetch from 'node-fetch';

// Initialize client
const init = await fetch('http://localhost:3000/api/init', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ clientInfo: { name: 'otel-test' } }),
});

const { clientId, token } = await init.json();

// Execute code
const execute = await fetch('http://localhost:3000/api/execute', {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${token}`,
		'X-Client-ID': clientId,
	},
	body: JSON.stringify({
		code: `
            const user = await api.custom.getUser({ userId: '123' });
            console.log('User:', user);
            
            await api.custom.updateUser({ userId: '123', name: 'Jane Doe' });
            
            return { success: true };
        `,
	}),
});

const result = await execute.json();
console.log('Result:', result);
```

## Viewing Traces in Jaeger

1. Open http://localhost:16686
2. Select service: `agent-tool-protocol-example`
3. Click "Find Traces"
4. Click on a trace to see detailed execution flow

## Production Deployment

### With Datadog

```typescript
const sdk = new NodeSDK({
	resource: new Resource({
		[ATTR_SERVICE_NAME]: 'agent-tool-protocol',
		[ATTR_SERVICE_VERSION]: '1.0.0',
		env: process.env.NODE_ENV,
	}),
	traceExporter: new OTLPTraceExporter({
		url: 'https://api.datadoghq.com',
		headers: {
			'DD-API-KEY': process.env.DD_API_KEY,
		},
	}),
	// ... metrics exporter
});
```

### With New Relic

```typescript
const sdk = new NodeSDK({
	resource: new Resource({
		[ATTR_SERVICE_NAME]: 'agent-tool-protocol',
	}),
	traceExporter: new OTLPTraceExporter({
		url: 'https://otlp.nr-data.net',
		headers: {
			'api-key': process.env.NEW_RELIC_LICENSE_KEY,
		},
	}),
});
```

### With Grafana Cloud

```typescript
const sdk = new NodeSDK({
	resource: new Resource({
		[ATTR_SERVICE_NAME]: 'agent-tool-protocol',
	}),
	traceExporter: new OTLPTraceExporter({
		url: `https://otlp-gateway-${process.env.GRAFANA_ZONE}.grafana.net/otlp`,
		headers: {
			Authorization: `Basic ${Buffer.from(`${process.env.GRAFANA_INSTANCE_ID}:${process.env.GRAFANA_API_TOKEN}`).toString('base64')}`,
		},
	}),
});
```

## Benefits

✅ **Full Observability**: Traces, metrics, and logs in one place  
✅ **Distributed Tracing**: Track executions across pause/resume  
✅ **Performance Monitoring**: Identify slow tools and bottlenecks  
✅ **Security Auditing**: Track all sensitive and destructive operations  
✅ **Compliance**: Complete audit trail for regulatory requirements  
✅ **Debugging**: Rich context for troubleshooting issues

## Environment Variables

```bash
# OpenTelemetry configuration
OTEL_SERVICE_NAME=agent-tool-protocol
OTEL_SERVICE_VERSION=1.0.0
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1  # Sample 10% of traces in production
```

## Docker Compose

```yaml
version: '3.8'

services:
  atp-server:
    build: .
    environment:
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318
      - NODE_ENV=production
    ports:
      - '3000:3000'
    depends_on:
      - jaeger

  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - '16686:16686' # Jaeger UI
      - '4318:4318' # OTLP HTTP receiver
    environment:
      - COLLECTOR_OTLP_ENABLED=true
```

## Learn More

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [OTLP Specification](https://opentelemetry.io/docs/specs/otlp/)
