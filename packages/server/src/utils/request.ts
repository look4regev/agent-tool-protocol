import { IncomingMessage } from 'node:http';

/**
 * Default maximum request body size (10MB)
 */
export const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024;

/**
 * Reads the full request body as a string
 * @param req - The HTTP request
 * @param maxSize - Maximum allowed body size in bytes (default: 10MB)
 * @returns Promise resolving to the complete body string
 * @throws Error if body exceeds maxSize
 */
export function readBody(req: IncomingMessage, maxSize = DEFAULT_MAX_BODY_SIZE): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = '';
		let size = 0;

		req.on('data', (chunk) => {
			size += chunk.length;

			if (size > maxSize) {
				req.destroy();
				reject(new Error(`Request body too large (max ${maxSize} bytes)`));
				return;
			}

			body += chunk.toString();
		});

		req.on('end', () => resolve(body));
		req.on('error', reject);
	});
}

/**
 * Reads and parses request body as JSON
 * @param req - The HTTP request
 * @param maxSize - Maximum allowed body size in bytes
 * @returns Promise resolving to the parsed JSON object
 */
export async function readJsonBody<T = any>(
	req: IncomingMessage,
	maxSize = DEFAULT_MAX_BODY_SIZE
): Promise<T> {
	const body = await readBody(req, maxSize);
	try {
		return body ? JSON.parse(body) : (null as T);
	} catch (error) {
		throw new Error('Invalid JSON');
	}
}
