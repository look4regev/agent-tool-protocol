import type { AuditSink, AuditEvent } from '@mondaydotcomorg/atp-protocol';
import { log } from '@mondaydotcomorg/atp-runtime';

export interface AuditConfig {
	enabled: boolean;
	sinks?: AuditSink | AuditSink[];
}

interface AuditExecutionOptions {
	executionId?: string;
	apiKey?: string;
	ip?: string;
	code: string;
	result: any;
}

let auditQueue: AuditEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let auditSinks: AuditSink[] = [];
let isShutdown = false;

const FLUSH_INTERVAL = 5000;
const MAX_QUEUE_SIZE = 100;

export function initAudit(sinks?: AuditSink | AuditSink[]): void {
	if (sinks) {
		auditSinks = Array.isArray(sinks) ? sinks : [sinks];
	}
	isShutdown = false;
	startFlushTimer();
}

export async function auditExecution(options: AuditExecutionOptions): Promise<void> {
	if (isShutdown || auditSinks.length === 0) {
		return;
	}

	const event: AuditEvent = {
		eventId: options.executionId || `exec_${Date.now()}`,
		timestamp: Date.now(),
		clientId: options.apiKey || 'anonymous',
		eventType: 'execution',
		action: 'complete',
		code: options.code,
		status: options.result.status === 'completed' ? 'success' : 'failed',
		resourceId: options.executionId,
		metadata: {
			ip: options.ip,
			result: options.result,
		},
	};

	auditQueue.push(event);

	if (auditQueue.length >= MAX_QUEUE_SIZE) {
		await flushAuditQueue();
	}
}

export async function flushAuditQueue(): Promise<void> {
	if (auditQueue.length === 0 || auditSinks.length === 0) {
		return;
	}

	const events = [...auditQueue];
	auditQueue = [];

	try {
		await Promise.all(
			auditSinks.map(async (sink) => {
				if (sink.writeBatch) {
					await sink.writeBatch(events);
				} else {
					await Promise.all(events.map((event) => sink.write(event)));
				}
			})
		);
	} catch (error) {
		log.error('Failed to flush audit queue', { error });
	}
}

function startFlushTimer(): void {
	if (flushTimer) {
		clearInterval(flushTimer);
	}
	flushTimer = setInterval(() => {
		flushAuditQueue().catch((error) => {
			log.error('Failed to flush audit queue on timer', { error });
		});
	}, FLUSH_INTERVAL);
}

export function shutdownAudit(): void {
	isShutdown = true;
	if (flushTimer) {
		clearInterval(flushTimer);
		flushTimer = null;
	}
	auditSinks = [];
}
