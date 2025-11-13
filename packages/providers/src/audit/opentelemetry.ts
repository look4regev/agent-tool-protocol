import { trace, context, SpanStatusCode, metrics, Span } from '@opentelemetry/api';
import type { AuditSink, AuditEvent } from '@mondaydotcomorg/atp-protocol';
import {
	OTelCounter,
	OTelHistogram,
	OTelAttribute,
	METRIC_CONFIGS,
	OTEL_TRACER_NAME,
	OTEL_METER_NAME,
	ATTRIBUTE_PREFIX_TOOL,
	ATTRIBUTE_PREFIX_METADATA,
} from './otel-metrics.js';

/**
 * OpenTelemetry-based audit sink
 * Provides industry-standard observability with distributed tracing and metrics
 */
export class OpenTelemetryAuditSink implements AuditSink {
	name = 'opentelemetry';
	private tracer = trace.getTracer(OTEL_TRACER_NAME);
	private meter = metrics.getMeter(OTEL_METER_NAME);

	private executionCounter = this.meter.createCounter(
		OTelCounter.EXECUTIONS_TOTAL,
		METRIC_CONFIGS[OTelCounter.EXECUTIONS_TOTAL]
	);

	private toolCallCounter = this.meter.createCounter(
		OTelCounter.TOOLS_CALLS,
		METRIC_CONFIGS[OTelCounter.TOOLS_CALLS]
	);

	private llmCallCounter = this.meter.createCounter(
		OTelCounter.LLM_CALLS,
		METRIC_CONFIGS[OTelCounter.LLM_CALLS]
	);

	private approvalCounter = this.meter.createCounter(
		OTelCounter.APPROVALS_TOTAL,
		METRIC_CONFIGS[OTelCounter.APPROVALS_TOTAL]
	);

	private executionDuration = this.meter.createHistogram(
		OTelHistogram.EXECUTION_DURATION,
		METRIC_CONFIGS[OTelHistogram.EXECUTION_DURATION]
	);

	private toolDuration = this.meter.createHistogram(
		OTelHistogram.TOOL_DURATION,
		METRIC_CONFIGS[OTelHistogram.TOOL_DURATION]
	);

	async write(event: AuditEvent): Promise<void> {
		const span = this.tracer.startSpan(`atp.${event.eventType}.${event.action}`, {
			attributes: this.buildAttributes(event),
		});

		await context.with(trace.setSpan(context.active(), span), async () => {
			try {
				this.handleEvent(span, event);
				this.recordMetrics(event);
				span.setStatus({ code: SpanStatusCode.OK });
			} catch (error: any) {
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: error.message,
				});
				span.recordException(error);
			} finally {
				span.end();
			}
		});
	}

	async writeBatch(events: AuditEvent[]): Promise<void> {
		await Promise.all(events.map((event) => this.write(event)));
	}

	private buildAttributes(event: AuditEvent): Record<string, any> {
		const attrs: Record<string, any> = {
			[OTelAttribute.EVENT_ID]: event.eventId,
			[OTelAttribute.EVENT_TYPE]: event.eventType,
			[OTelAttribute.EVENT_ACTION]: event.action,
			[OTelAttribute.TIMESTAMP]: event.timestamp,

			[OTelAttribute.CLIENT_ID]: event.clientId,
			[OTelAttribute.STATUS]: event.status,
		};

		if (event.userId) attrs[OTelAttribute.USER_ID] = event.userId;
		if (event.ipAddress) attrs[OTelAttribute.IP_ADDRESS] = event.ipAddress;
		if (event.userAgent) attrs[OTelAttribute.USER_AGENT] = event.userAgent;

		if (event.resource) attrs[OTelAttribute.RESOURCE] = event.resource;
		if (event.resourceId) attrs[OTelAttribute.RESOURCE_ID] = event.resourceId;

		if (event.toolName) attrs[OTelAttribute.TOOL_NAME] = event.toolName;
		if (event.apiGroup) attrs[OTelAttribute.API_GROUP] = event.apiGroup;

		if (event.duration !== undefined) attrs[OTelAttribute.DURATION_MS] = event.duration;
		if (event.memoryUsed !== undefined) attrs[OTelAttribute.MEMORY_BYTES] = event.memoryUsed;
		if (event.llmCallsCount !== undefined) attrs[OTelAttribute.LLM_CALLS] = event.llmCallsCount;
		if (event.httpCallsCount !== undefined) attrs[OTelAttribute.HTTP_CALLS] = event.httpCallsCount;

		if (event.riskScore !== undefined) attrs[OTelAttribute.RISK_SCORE] = event.riskScore;
		if (event.securityEvents && event.securityEvents.length > 0) {
			attrs[OTelAttribute.SECURITY_EVENTS] = JSON.stringify(event.securityEvents);
			attrs[OTelAttribute.SECURITY_EVENTS_COUNT] = event.securityEvents.length;
		}

		if (event.error) {
			attrs[OTelAttribute.ERROR_MESSAGE] = event.error.message;
			if (event.error.code) attrs[OTelAttribute.ERROR_CODE] = event.error.code;
			if (event.error.stack) attrs[OTelAttribute.ERROR_STACK] = event.error.stack;
		}

		if (event.annotations) {
			Object.assign(attrs, this.flattenObject(event.annotations, ATTRIBUTE_PREFIX_TOOL));
		}

		if (event.metadata) {
			Object.assign(attrs, this.flattenObject(event.metadata, ATTRIBUTE_PREFIX_METADATA));
		}

		return attrs;
	}

	private handleEvent(span: Span, event: AuditEvent): void {
		switch (event.eventType) {
			case 'execution':
				if (event.action === 'start') {
					span.addEvent('Execution started', {
						'client.id': event.clientId,
						'resource.id': event.resourceId,
					});
				} else if (event.action === 'complete') {
					span.addEvent('Execution completed', {
						duration_ms: event.duration,
						status: event.status,
						llm_calls: event.llmCallsCount,
					});
				} else if (event.action === 'pause') {
					span.addEvent('Execution paused', {
						status: event.status,
					});
				} else if (event.action === 'resume') {
					span.addEvent('Execution resumed', {
						'resource.id': event.resourceId,
					});
				}
				break;

			case 'tool_call':
				span.addEvent(`Tool ${event.action}`, {
					'tool.name': event.toolName,
					'api.group': event.apiGroup,
					duration_ms: event.duration,
				});
				if (event.input) {
					span.setAttribute(OTelAttribute.TOOL_INPUT_SIZE, JSON.stringify(event.input).length);
				}
				if (event.output) {
					span.setAttribute(OTelAttribute.TOOL_OUTPUT_SIZE, JSON.stringify(event.output).length);
				}
				break;

			case 'llm_call':
				span.addEvent('LLM call', {
					duration_ms: event.duration,
				});
				break;

			case 'approval':
				span.addEvent(`Approval ${event.action}`, {
					'tool.name': event.toolName,
				});
				break;

			case 'error':
				if (event.error) {
					span.addEvent('Error occurred', {
						'error.message': event.error.message,
						'error.code': event.error.code,
					});
					span.recordException(new Error(event.error.message));
				}
				break;

			case 'client_init':
				span.addEvent('Client initialized', {
					'client.id': event.clientId,
				});
				break;
		}

		if (event.securityEvents && event.securityEvents.length > 0) {
			for (const secEvent of event.securityEvents) {
				span.addEvent('Security event', {
					'security.event': secEvent,
					'security.risk_score': event.riskScore,
				});
			}
		}
	}

	private recordMetrics(event: AuditEvent): void {
		const commonAttrs: Record<string, any> = {
			client_id: event.clientId,
			event_type: event.eventType,
			status: event.status,
		};

		switch (event.eventType) {
			case 'execution':
				this.executionCounter.add(1, {
					...commonAttrs,
					action: event.action,
				});

				if (event.duration !== undefined) {
					this.executionDuration.record(event.duration, {
						...commonAttrs,
						action: event.action,
					});
				}
				break;

			case 'tool_call':
				this.toolCallCounter.add(1, {
					...commonAttrs,
					tool_name: event.toolName,
					api_group: event.apiGroup,
				});

				if (event.duration !== undefined) {
					this.toolDuration.record(event.duration, {
						...commonAttrs,
						tool_name: event.toolName,
					});
				}
				break;

			case 'llm_call':
				this.llmCallCounter.add(1, commonAttrs);
				break;

			case 'approval':
				this.approvalCounter.add(1, {
					...commonAttrs,
					action: event.action,
				});
				break;
		}

		if (event.securityEvents && event.securityEvents.length > 0) {
			const securityEventCounter = this.meter.createCounter(
				OTelCounter.SECURITY_EVENTS,
				METRIC_CONFIGS[OTelCounter.SECURITY_EVENTS]
			);
			securityEventCounter.add(event.securityEvents.length, {
				...commonAttrs,
				risk_score: event.riskScore,
			});
		}
	}

	private flattenObject(obj: any, prefix: string): Record<string, any> {
		const result: Record<string, any> = {};
		if (!obj || typeof obj !== 'object') return result;

		for (const [key, value] of Object.entries(obj)) {
			const fullKey = `${prefix}.${key}`;
			if (value === null || value === undefined) {
				continue;
			}
			if (typeof value === 'object' && !Array.isArray(value)) {
				Object.assign(result, this.flattenObject(value, fullKey));
			} else if (Array.isArray(value)) {
				result[fullKey] = JSON.stringify(value);
			} else {
				result[fullKey] = value;
			}
		}
		return result;
	}
}
