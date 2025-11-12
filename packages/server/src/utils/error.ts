import { ServerResponse } from 'node:http';
import { log } from '@agent-tool-protocol/runtime';

/**
 * Handles HTTP request errors and sends appropriate responses
 */
export function handleError(
	res: ServerResponse,
	error: Error & { status?: number },
	requestId: string,
	additionalHeaders?: Map<string, string>
): void {
	const status = error.status || 500;
	log.error('Request failed', { requestId, error: error.message, stack: error.stack });

	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (additionalHeaders) {
		for (const [key, value] of additionalHeaders.entries()) {
			headers[key] = value;
		}
	}

	res.writeHead(status, headers);
	res.end(JSON.stringify({ error: error.message, requestId }));
}
