import { createServer, Server, IncomingMessage, ServerResponse } from 'http';

export interface PublicApiMockConfig {
	port: number;
}

interface PublicData {
	id: string;
	value: string;
	category: string;
}

export class PublicApiMockServer {
	private server: Server | null = null;
	private port: number;
	private data: PublicData[] = [];

	constructor(config: PublicApiMockConfig) {
		this.port = config.port;
		this.initializeMockData();
	}

	private initializeMockData(): void {
		this.data = [
			{ id: '1', value: 'Public data 1', category: 'general' },
			{ id: '2', value: 'Public data 2', category: 'info' },
			{ id: '3', value: 'Public data 3', category: 'general' },
		];
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
		const url = new URL(req.url || '', `http://localhost:${this.port}`);
		res.setHeader('Content-Type', 'application/json');

		try {
			if (url.pathname === '/public/data' && req.method === 'GET') {
				await this.handleGetData(url, res);
			} else if (url.pathname === '/public/status' && req.method === 'GET') {
				await this.handleGetStatus(res);
			} else {
				res.statusCode = 404;
				res.end(JSON.stringify({ error: 'Not Found' }));
			}
		} catch (error: any) {
			res.statusCode = 500;
			res.end(JSON.stringify({ error: error.message }));
		}
	}

	private async handleGetData(url: URL, res: ServerResponse): Promise<void> {
		const category = url.searchParams.get('category');

		let filteredData = this.data;
		if (category) {
			filteredData = this.data.filter((d) => d.category === category);
		}

		res.statusCode = 200;
		res.end(
			JSON.stringify({
				data: filteredData,
				count: filteredData.length,
			})
		);
	}

	private async handleGetStatus(res: ServerResponse): Promise<void> {
		res.statusCode = 200;
		res.end(
			JSON.stringify({
				status: 'ok',
				timestamp: Date.now(),
				version: '1.0.0',
			})
		);
	}

	getPort(): number {
		return this.port;
	}
}
