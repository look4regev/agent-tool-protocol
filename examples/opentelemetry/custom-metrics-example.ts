/**
 * Custom OpenTelemetry Metrics Example
 * Shows how to use ATP's OTel metric enums for custom instrumentation
 */

import { trace, metrics } from '@opentelemetry/api';
import {
	OTelCounter,
	OTelHistogram,
	OTelAttribute,
	OTEL_TRACER_NAME,
	OTEL_METER_NAME,
} from '@mondaydotcomorg/atp-providers';

// Get tracer and meter using ATP's standard names
const tracer = trace.getTracer(OTEL_TRACER_NAME);
const meter = metrics.getMeter(OTEL_METER_NAME);

// Example 1: Query ATP metrics by name
console.log('ATP Standard Metrics:');
console.log(`  Executions: ${OTelCounter.EXECUTIONS_TOTAL}`);
console.log(`  Tools: ${OTelCounter.TOOLS_CALLS}`);
console.log(`  LLM: ${OTelCounter.LLM_CALLS}`);
console.log(`  Duration: ${OTelHistogram.EXECUTION_DURATION}`);

// Example 2: Add custom instrumentation using ATP attributes
const customSpan = tracer.startSpan('custom.operation');
customSpan.setAttributes({
	// Use ATP's standard attribute names for consistency
	[OTelAttribute.CLIENT_ID]: 'my-client-123',
	[OTelAttribute.TOOL_NAME]: 'custom-tool',
	[OTelAttribute.DURATION_MS]: 150,

	// Add your custom attributes
	'custom.my_attribute': 'value',
});
customSpan.end();

// Example 3: Create custom metrics that align with ATP's naming
const customCounter = meter.createCounter('atp.custom.operations', {
	description: 'Custom operations counter',
	unit: '1',
});

customCounter.add(1, {
	// Use ATP attribute names for consistency in queries
	[OTelAttribute.STATUS]: 'success',
	[OTelAttribute.CLIENT_ID]: 'my-client-123',
});

// Example 4: Build a Datadog/Honeycomb query using the enums
console.log('\n📊 Example Queries:');
console.log('\nDatadog APM:');
console.log(`  COUNT(${OTelCounter.EXECUTIONS_TOTAL}){${OTelAttribute.STATUS}:completed}`);
console.log(`  P95(${OTelHistogram.EXECUTION_DURATION}){${OTelAttribute.CLIENT_ID}:*}`);

console.log('\nHoneycomb:');
console.log(`  COUNT | WHERE ${OTelAttribute.EVENT_TYPE} = "execution"`);
console.log(`  P95(${OTelAttribute.DURATION_MS}) | GROUP BY ${OTelAttribute.TOOL_NAME}`);

console.log('\nPrometheus:');
console.log(`  rate(${OTelCounter.EXECUTIONS_TOTAL}[5m])`);
console.log(`  histogram_quantile(0.95, ${OTelHistogram.EXECUTION_DURATION})`);

// Example 5: Custom monitoring dashboard config
const dashboardMetrics = {
	// Counters
	counters: [
		OTelCounter.EXECUTIONS_TOTAL,
		OTelCounter.TOOLS_CALLS,
		OTelCounter.LLM_CALLS,
		OTelCounter.APPROVALS_TOTAL,
		OTelCounter.SECURITY_EVENTS,
	],

	// Histograms (for percentiles)
	histograms: [OTelHistogram.EXECUTION_DURATION, OTelHistogram.TOOL_DURATION],

	// Key attributes for grouping
	groupBy: [
		OTelAttribute.CLIENT_ID,
		OTelAttribute.TOOL_NAME,
		OTelAttribute.STATUS,
		OTelAttribute.API_GROUP,
	],

	// Filters
	filters: {
		highRisk: `${OTelAttribute.RISK_SCORE} > 0.7`,
		errors: `${OTelAttribute.STATUS} = "error"`,
		slowExecutions: `${OTelAttribute.DURATION_MS} > 5000`,
	},
};

console.log('\n📈 Dashboard Config:');
console.log(JSON.stringify(dashboardMetrics, null, 2));

// Example 6: Alert conditions using enums
const alertConditions = {
	highErrorRate: {
		metric: OTelCounter.EXECUTIONS_TOTAL,
		filter: `${OTelAttribute.STATUS}:error`,
		threshold: '> 5% of total',
	},
	slowExecutions: {
		metric: OTelHistogram.EXECUTION_DURATION,
		aggregation: 'P95',
		threshold: '> 10000ms',
	},
	securityEvents: {
		metric: OTelCounter.SECURITY_EVENTS,
		filter: `${OTelAttribute.RISK_SCORE} > 0.8`,
		threshold: '> 0',
	},
};

console.log('\n🚨 Alert Conditions:');
console.log(JSON.stringify(alertConditions, null, 2));

export { dashboardMetrics, alertConditions };
