import { createServer, Server, IncomingMessage, ServerResponse } from 'http';

export interface StripeMockConfig {
	port: number;
}

interface Customer {
	id: string;
	email: string;
	name: string;
	created: number;
}

interface Charge {
	id: string;
	amount: number;
	currency: string;
	customer: string;
	status: string;
	created: number;
}

export class StripeMockServer {
	private server: Server | null = null;
	private port: number;
	private customers: Map<string, Customer> = new Map();
	private charges: Map<string, Charge> = new Map();
	private customerIdCounter = 1;
	private chargeIdCounter = 1;

	constructor(config: StripeMockConfig) {
		this.port = config.port;
		this.initializeMockData();
	}

	private initializeMockData(): void {
		const customer: Customer = {
			id: 'cus_1',
			email: 'test@example.com',
			name: 'Test Customer',
			created: Date.now(),
		};
		this.customers.set(customer.id, customer);

		const charge: Charge = {
			id: 'ch_1',
			amount: 1000,
			currency: 'usd',
			customer: 'cus_1',
			status: 'succeeded',
			created: Date.now(),
		};
		this.charges.set(charge.id, charge);
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
			if (url.pathname === '/v1/customers' && req.method === 'GET') {
				await this.handleListCustomers(res);
			} else if (url.pathname === '/v1/customers' && req.method === 'POST') {
				await this.handleCreateCustomer(req, res);
			} else if (url.pathname === '/v1/charges' && req.method === 'GET') {
				await this.handleListCharges(res);
			} else if (url.pathname === '/v1/charges' && req.method === 'POST') {
				await this.handleCreateCharge(req, res);
			} else {
				res.statusCode = 404;
				res.end(JSON.stringify({ error: { message: 'Not Found' } }));
			}
		} catch (error: any) {
			res.statusCode = 500;
			res.end(JSON.stringify({ error: { message: error.message } }));
		}
	}

	private validateAuth(req: IncomingMessage, res: ServerResponse): boolean {
		const authHeader = req.headers.authorization;

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			res.statusCode = 401;
			res.setHeader('Content-Type', 'application/json');
			res.end(
				JSON.stringify({
					error: { message: 'You did not provide an API key' },
				})
			);
			return false;
		}

		const apiKey = authHeader.substring(7);

		if (!apiKey.startsWith('sk_test_')) {
			res.statusCode = 401;
			res.setHeader('Content-Type', 'application/json');
			res.end(
				JSON.stringify({
					error: { message: 'Invalid API Key' },
				})
			);
			return false;
		}

		return true;
	}

	private async handleListCustomers(res: ServerResponse): Promise<void> {
		const customers = Array.from(this.customers.values());
		res.statusCode = 200;
		res.end(
			JSON.stringify({
				object: 'list',
				data: customers,
				has_more: false,
			})
		);
	}

	private async handleCreateCustomer(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const body = await this.readBody(req);
		const params = new URLSearchParams(body);

		const customer: Customer = {
			id: `cus_${this.customerIdCounter++}`,
			email: params.get('email') || '',
			name: params.get('name') || '',
			created: Math.floor(Date.now() / 1000),
		};

		this.customers.set(customer.id, customer);

		res.statusCode = 200;
		res.end(JSON.stringify(customer));
	}

	private async handleListCharges(res: ServerResponse): Promise<void> {
		const charges = Array.from(this.charges.values());
		res.statusCode = 200;
		res.end(
			JSON.stringify({
				object: 'list',
				data: charges,
				has_more: false,
			})
		);
	}

	private async handleCreateCharge(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const body = await this.readBody(req);
		const params = new URLSearchParams(body);

		const charge: Charge = {
			id: `ch_${this.chargeIdCounter++}`,
			amount: parseInt(params.get('amount') || '0'),
			currency: params.get('currency') || 'usd',
			customer: params.get('customer') || '',
			status: 'succeeded',
			created: Math.floor(Date.now() / 1000),
		};

		this.charges.set(charge.id, charge);

		res.statusCode = 200;
		res.end(JSON.stringify(charge));
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
