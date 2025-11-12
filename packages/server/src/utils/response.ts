import { ServerResponse } from 'node:http';

/**
 * Sends a JSON response
 */
export function sendJson(res: ServerResponse, data: unknown, status = 200): void {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(data));
}

/**
 * Sends an error response
 */
export function sendError(
	res: ServerResponse,
	error: string | Error,
	status = 500,
	requestId?: string
): void {
	const message = error instanceof Error ? error.message : error;
	sendJson(
		res,
		{
			error: message,
			...(requestId && { requestId }),
		},
		status
	);
}

/**
 * Sends a 404 Not Found response
 */
export function send404(res: ServerResponse): void {
	sendJson(res, { error: 'Not found' }, 404);
}

/**
 * Sends a 400 Bad Request response
 */
export function sendBadRequest(res: ServerResponse, message: string): void {
	sendJson(res, { error: message }, 400);
}

/**
 * Sends a 503 Service Unavailable response
 */
export function sendServiceUnavailable(res: ServerResponse, message: string): void {
	sendJson(res, { error: message }, 503);
}

/**
 * Sets CORS headers on a response
 */
export function setCorsHeaders(res: ServerResponse, origin = '*'): void {
	res.setHeader('Access-Control-Allow-Origin', origin);
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-ID');
	res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * Handles OPTIONS preflight requests
 */
export function handleOptions(res: ServerResponse): void {
	setCorsHeaders(res);
	res.writeHead(204);
	res.end();
}
