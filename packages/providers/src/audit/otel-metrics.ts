/**
 * OpenTelemetry Metrics Definitions

/**
 * Counter metric names
 */
export enum OTelCounter {
	EXECUTIONS_TOTAL = 'atp.executions.total',
	TOOLS_CALLS = 'atp.tools.calls',
	LLM_CALLS = 'atp.llm.calls',
	APPROVALS_TOTAL = 'atp.approvals.total',
	SECURITY_EVENTS = 'atp.security.events',
}

/**
 * Histogram metric names
 */
export enum OTelHistogram {
	EXECUTION_DURATION = 'atp.execution.duration',
	TOOL_DURATION = 'atp.tool.duration',
}

/**
 * Span/trace names
 */
export enum OTelSpan {
	EXECUTION_START = 'atp.execution.start',
	EXECUTION_COMPLETE = 'atp.execution.complete',
	EXECUTION_PAUSE = 'atp.execution.pause',
	EXECUTION_RESUME = 'atp.execution.resume',
	EXECUTION_ERROR = 'atp.execution.error',
	TOOL_CALL = 'atp.tool_call',
	LLM_CALL = 'atp.llm_call',
	APPROVAL_REQUEST = 'atp.approval.request',
	APPROVAL_RESPONSE = 'atp.approval.response',
	CLIENT_INIT = 'atp.client_init',
	ERROR = 'atp.error',
}

/**
 * Attribute names (for consistent span/metric attributes)
 */
export enum OTelAttribute {
	EVENT_ID = 'atp.event.id',
	EVENT_TYPE = 'atp.event.type',
	EVENT_ACTION = 'atp.event.action',
	TIMESTAMP = 'atp.timestamp',

	CLIENT_ID = 'atp.client.id',
	USER_ID = 'atp.user.id',
	IP_ADDRESS = 'atp.ip_address',
	USER_AGENT = 'atp.user_agent',
	STATUS = 'atp.status',

	RESOURCE = 'atp.resource',
	RESOURCE_ID = 'atp.resource.id',

	TOOL_NAME = 'atp.tool.name',
	TOOL_INPUT_SIZE = 'tool.input_size',
	TOOL_OUTPUT_SIZE = 'tool.output_size',
	API_GROUP = 'atp.api.group',

	DURATION_MS = 'atp.duration_ms',
	MEMORY_BYTES = 'atp.memory_bytes',
	LLM_CALLS = 'atp.llm_calls',
	HTTP_CALLS = 'atp.http_calls',

	RISK_SCORE = 'atp.security.risk_score',
	SECURITY_EVENTS = 'atp.security.events',
	SECURITY_EVENTS_COUNT = 'atp.security.events_count',

	ERROR_MESSAGE = 'atp.error.message',
	ERROR_CODE = 'atp.error.code',
	ERROR_STACK = 'atp.error.stack',
}

/**
 * Metric configurations
 */
export const METRIC_CONFIGS = {
	[OTelCounter.EXECUTIONS_TOTAL]: {
		description: 'Total number of executions',
		unit: '1',
	},
	[OTelCounter.TOOLS_CALLS]: {
		description: 'Tool call count',
		unit: '1',
	},
	[OTelCounter.LLM_CALLS]: {
		description: 'LLM call count',
		unit: '1',
	},
	[OTelCounter.APPROVALS_TOTAL]: {
		description: 'Approval request count',
		unit: '1',
	},
	[OTelCounter.SECURITY_EVENTS]: {
		description: 'Security events count',
		unit: '1',
	},
	[OTelHistogram.EXECUTION_DURATION]: {
		description: 'Execution duration in milliseconds',
		unit: 'ms',
	},
	[OTelHistogram.TOOL_DURATION]: {
		description: 'Tool execution duration',
		unit: 'ms',
	},
} as const;

/**
 * OpenTelemetry tracer and meter names
 */
export const OTEL_SERVICE_NAME = 'agent-tool-protocol';
export const OTEL_TRACER_NAME = 'agent-tool-protocol';
export const OTEL_METER_NAME = 'agent-tool-protocol';

/**
 * Attribute prefixes for custom metadata
 */
export const ATTRIBUTE_PREFIX_TOOL = 'atp.tool';
export const ATTRIBUTE_PREFIX_METADATA = 'atp.metadata';
