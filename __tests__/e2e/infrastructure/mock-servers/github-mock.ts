import { createServer, Server, IncomingMessage, ServerResponse } from 'http';

export interface GitHubMockConfig {
	port: number;
	oauthIntrospectUrl?: string;
}

interface Repository {
	id: number;
	name: string;
	full_name: string;
	owner: { login: string; id: number };
	private: boolean;
}

interface User {
	id: number;
	login: string;
	name: string;
	email: string;
}

interface Organization {
	id: number;
	login: string;
	description: string;
}

export class GitHubMockServer {
	private server: Server | null = null;
	private port: number;
	private oauthIntrospectUrl?: string;
	private repos: Map<number, Repository> = new Map();
	private repoIdCounter = 1;

	constructor(config: GitHubMockConfig) {
		this.port = config.port;
		this.oauthIntrospectUrl = config.oauthIntrospectUrl;
		this.initializeMockData();
	}

	private initializeMockData(): void {
		this.repos.set(1, {
			id: 1,
			name: 'test-repo',
			full_name: 'testuser/test-repo',
			owner: { login: 'testuser', id: 1 },
			private: false,
		});
		this.repos.set(2, {
			id: 2,
			name: 'private-repo',
			full_name: 'testuser/private-repo',
			owner: { login: 'testuser', id: 1 },
			private: true,
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
		const scopes = await this.validateAuth(req, res);
		if (!scopes) return;

		const url = new URL(req.url || '', `http://localhost:${this.port}`);
		res.setHeader('Content-Type', 'application/json');

		try {
			if (url.pathname === '/user' && req.method === 'GET') {
				await this.handleGetUser(scopes, res);
			} else if (url.pathname === '/repos' && req.method === 'GET') {
				await this.handleListRepos(scopes, res);
			} else if (url.pathname === '/user/repos' && req.method === 'POST') {
				await this.handleCreateRepo(req, scopes, res);
			} else if (url.pathname.match(/^\/repos\/\d+$/) && req.method === 'DELETE') {
				await this.handleDeleteRepo(url.pathname, scopes, res);
			} else if (url.pathname.match(/^\/orgs\/[\w-]+$/) && req.method === 'GET') {
				await this.handleGetOrg(url.pathname, scopes, res);
			} else {
				res.statusCode = 404;
				res.end(JSON.stringify({ message: 'Not Found' }));
			}
		} catch (error: any) {
			res.statusCode = 500;
			res.end(JSON.stringify({ message: error.message }));
		}
	}

	private async validateAuth(req: IncomingMessage, res: ServerResponse): Promise<string[] | null> {
		const authHeader = req.headers.authorization;

		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			res.statusCode = 401;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ message: 'Requires authentication' }));
			return null;
		}

		const token = authHeader.substring(7);

		if (this.oauthIntrospectUrl) {
			try {
				const response = await fetch(this.oauthIntrospectUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: `token=${token}`,
				});

				const data = (await response.json()) as { active: boolean; scope: string };
				if (!data.active) {
					res.statusCode = 401;
					res.setHeader('Content-Type', 'application/json');
					res.end(JSON.stringify({ message: 'Bad credentials' }));
					return null;
				}

				return data.scope ? data.scope.split(' ') : [];
			} catch (error) {
				res.statusCode = 500;
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify({ message: 'Auth validation failed' }));
				return null;
			}
		}

		return ['repo', 'read:user', 'admin:org', 'delete_repo'];
	}

	private async handleGetUser(scopes: string[], res: ServerResponse): Promise<void> {
		if (!scopes.includes('read:user')) {
			res.statusCode = 403;
			res.end(
				JSON.stringify({
					message: 'Insufficient scope',
					required_scopes: ['read:user'],
				})
			);
			return;
		}

		const user: User = {
			id: 1,
			login: 'testuser',
			name: 'Test User',
			email: 'test@example.com',
		};

		res.statusCode = 200;
		res.end(JSON.stringify(user));
	}

	private async handleListRepos(scopes: string[], res: ServerResponse): Promise<void> {
		if (!scopes.includes('repo')) {
			res.statusCode = 403;
			res.end(
				JSON.stringify({
					message: 'Insufficient scope',
					required_scopes: ['repo'],
				})
			);
			return;
		}

		const repos = Array.from(this.repos.values());
		res.statusCode = 200;
		res.end(JSON.stringify(repos));
	}

	private async handleCreateRepo(
		req: IncomingMessage,
		scopes: string[],
		res: ServerResponse
	): Promise<void> {
		if (!scopes.includes('repo')) {
			res.statusCode = 403;
			res.end(
				JSON.stringify({
					message: 'Insufficient scope',
					required_scopes: ['repo'],
				})
			);
			return;
		}

		const body = await this.readBody(req);
		const data = JSON.parse(body);

		const newRepo: Repository = {
			id: this.repoIdCounter++,
			name: data.name,
			full_name: `testuser/${data.name}`,
			owner: { login: 'testuser', id: 1 },
			private: data.private || false,
		};

		this.repos.set(newRepo.id, newRepo);

		res.statusCode = 201;
		res.end(JSON.stringify(newRepo));
	}

	private async handleDeleteRepo(
		pathname: string,
		scopes: string[],
		res: ServerResponse
	): Promise<void> {
		if (!scopes.includes('delete_repo')) {
			res.statusCode = 403;
			res.end(
				JSON.stringify({
					message: 'Insufficient scope',
					required_scopes: ['delete_repo'],
				})
			);
			return;
		}

		const repoId = parseInt(pathname.split('/').pop()!);
		if (this.repos.has(repoId)) {
			this.repos.delete(repoId);
			res.statusCode = 204;
			res.end();
		} else {
			res.statusCode = 404;
			res.end(JSON.stringify({ message: 'Not Found' }));
		}
	}

	private async handleGetOrg(
		pathname: string,
		scopes: string[],
		res: ServerResponse
	): Promise<void> {
		if (!scopes.includes('admin:org')) {
			res.statusCode = 403;
			res.end(
				JSON.stringify({
					message: 'Insufficient scope',
					required_scopes: ['admin:org'],
				})
			);
			return;
		}

		const orgName = pathname.split('/').pop();
		const org: Organization = {
			id: 1,
			login: orgName!,
			description: 'Test organization',
		};

		res.statusCode = 200;
		res.end(JSON.stringify(org));
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
