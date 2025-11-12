import type { RequestContext } from '../core/config.js';
import type { ClientSessionManager } from '../client-sessions.js';
import type { AuditSink, AuditEvent } from '@agent-tool-protocol/protocol';
import { nanoid } from 'nanoid';
import { log } from '@agent-tool-protocol/runtime';

export async function handleInit(
	ctx: RequestContext,
	sessionManager: ClientSessionManager,
	auditSink?: AuditSink
): Promise<unknown> {
	const request = ctx.body as any;

	if (request.tools && Array.isArray(request.tools)) {
		log.info('Client registering tools', {
			toolCount: request.tools.length,
			toolNames: request.tools.map((t: any) => t.name),
		});

		for (const tool of request.tools) {
			if (!tool.name || typeof tool.name !== 'string') {
				ctx.throw(400, 'Invalid tool definition: name is required');
			}
			if (!tool.description || typeof tool.description !== 'string') {
				ctx.throw(400, `Invalid tool definition for '${tool.name}': description is required`);
			}
			if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
				ctx.throw(400, `Invalid tool definition for '${tool.name}': inputSchema is required`);
			}
		}
	}

	const result = await sessionManager.initClient(request || {});

	if (auditSink) {
		const event: AuditEvent = {
			eventId: nanoid(),
			timestamp: Date.now(),
			clientId: (result as any).clientId,
			eventType: 'client_init',
			action: 'init',
			status: 'success',
			metadata: {
				clientInfo: request.clientInfo,
				toolsRegistered: request.tools ? request.tools.length : 0,
				toolNames: request.tools ? request.tools.map((t: any) => t.name) : [],
			},
		};
		await auditSink.write(event).catch(() => {});
	}

	return result;
}
