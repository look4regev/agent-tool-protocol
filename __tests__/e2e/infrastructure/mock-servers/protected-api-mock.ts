import { createServer, Server, IncomingMessage, ServerResponse } from 'http';

export interface ProtectedApiMockConfig {
	port: number;
	token?: string;
}

interface ProtectedResource {
	id: string;
	data: string;
	timestamp: number;
}

export class ProtectedApiMockServer {
	private server: Server | null = null;
	private port: number;
	private validToken: string;
	private resources: Map<string, ProtectedResource> = new Map();

	constructor(config: ProtectedApiMockConfig) {
		this.port = config.port;
		this.validToken = config.token || 'test-protected-token';
		this.initializeMockData();
	}

	private initializeMockData(): void {
		this.resources.set('resource1', {
			id: 'resource1',
			data: 'Protected data 1',
			timestamp: Date.now(),
		});
		this.resources.set('resource2', {
			id: 'resource2',
			data: 'Protected data 2',
			timestamp: Date.now(),
		});
	}

	async start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server = createServer((req, res) => this.handleRequest(req, res));
			this.server.on('error', reject);
			this.server.listen(this.port, () => resolve());
		});
	}

	async stop(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.server) {
				resolve();
				return;
			}
			this.server.close((err) => {
				if (err) reject(err);
				else {
					this.server = null;
					resolve();
				}
			});
		});
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		if (!this.validateAuth(req, res)) return;

		const url = new URL(req.url || '', `http://localhost:${this.port}`);
		res.setHeader('Content-Type', 'application/json');

		try {
			if (url.pathname === '/protected/resource' && req.method === 'GET') {
				await this.handleGetResource(url, res);
			} else if (url.pathname === '/protected/action' && req.method === 'POST') {
				await this.handleAction(req, res);
			} else {
				res.statusCode = 404;
				res.end(JSON.stringify({ error: 'Not Found' }));
			}
		} catch (error: any) {
			res.statusCode = 500;
			res.end(JSON.stringify({ error: error.message }));
		}
	}

	private validateAuth(req: IncomingMessage, res: ServerResponse): boolean {
		const authHeader = req.headers.authorization;

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			res.statusCode = 401;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ error: 'Authentication required' }));
			return false;
		}

		const token = authHeader.substring(7);
		if (token !== this.validToken) {
			res.statusCode = 401;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ error: 'Invalid token' }));
			return false;
		}

		return true;
	}

	private async handleGetResource(url: URL, res: ServerResponse): Promise<void> {
		const resourceId = url.searchParams.get('id');

		if (!resourceId) {
			const allResources = Array.from(this.resources.values());
			res.statusCode = 200;
			res.end(JSON.stringify({ resources: allResources }));
			return;
		}

		const resource = this.resources.get(resourceId);
		if (!resource) {
			res.statusCode = 404;
			res.end(JSON.stringify({ error: 'Resource not found' }));
			return;
		}

		res.statusCode = 200;
		res.end(JSON.stringify(resource));
	}

	private async handleAction(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const body = await this.readBody(req);
		const data = JSON.parse(body);

		res.statusCode = 200;
		res.end(
			JSON.stringify({
				success: true,
				action: data.action,
				timestamp: Date.now(),
			})
		);
	}

	private readBody(req: IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			let body = '';
			req.on('data', (chunk) => (body += chunk));
			req.on('end', () => resolve(body));
			req.on('error', reject);
		});
	}

	getPort(): number {
		return this.port;
	}
}
