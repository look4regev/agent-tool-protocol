import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../utils/response.js';

export async function handleInfo(req: IncomingMessage, res: ServerResponse): Promise<void> {
	sendJson(res, {
		version: '1.0.0',
		capabilities: {
			execution: true,
			search: true,
			streaming: true,
			llmCalls: true,
		},
	});
}
