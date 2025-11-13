import { IncomingMessage } from 'node:http';
import { readJsonBody } from '../utils/request.js';

export function parseBody(req: IncomingMessage): Promise<unknown> {
	return readJsonBody(req);
}

export function parseQuery(url: string): Record<string, string> {
	const queryIndex = url.indexOf('?');
	if (queryIndex === -1) return {};

	const queryString = url.substring(queryIndex + 1);
	const params = new URLSearchParams(queryString);
	const result: Record<string, string> = {};

	for (const [key, value] of params) {
		result[key] = value;
	}

	return result;
}
