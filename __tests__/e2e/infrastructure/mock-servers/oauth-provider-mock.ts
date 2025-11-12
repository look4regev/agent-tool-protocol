import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { randomBytes } from 'crypto';

export interface TokenData {
	userId: string;
	scopes: string[];
	issuedAt: number;
	expiresIn: number;
	refreshToken?: string;
}

export interface TokenInfo {
	valid: boolean;
	scopes?: string[];
	userId?: string;
	expiresAt?: number;
}

export interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token?: string;
	scope: string;
}

export class MockOAuthProvider {
	private tokens: Map<string, TokenData> = new Map();
	private refreshTokens: Map<string, string> = new Map();
	private server: Server | null = null;
	private port: number;

	constructor(port: number) {
		this.port = port;
	}

	issueToken(userId: string, scopes: string[], expiresIn: number = 3600): TokenResponse {
		const accessToken = `mock_token_${randomBytes(16).toString('hex')}`;
		const refreshToken = `mock_refresh_${randomBytes(16).toString('hex')}`;

		const tokenData: TokenData = {
			userId,
			scopes,
			issuedAt: Date.now(),
			expiresIn,
			refreshToken,
		};

		this.tokens.set(accessToken, tokenData);
		this.refreshTokens.set(refreshToken, accessToken);

		return {
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: expiresIn,
			refresh_token: refreshToken,
			scope: scopes.join(' '),
		};
	}

	async introspect(token: string): Promise<TokenInfo> {
		const tokenData = this.tokens.get(token);

		if (!tokenData) {
			return { valid: false };
		}

		const expiresAt = tokenData.issuedAt + tokenData.expiresIn * 1000;
		const isExpired = Date.now() > expiresAt;

		if (isExpired) {
			this.tokens.delete(token);
			return { valid: false };
		}

		return {
			valid: true,
			scopes: tokenData.scopes,
			userId: tokenData.userId,
			expiresAt,
		};
	}

	async refresh(refreshToken: string): Promise<TokenResponse> {
		const oldAccessToken = this.refreshTokens.get(refreshToken);

		if (!oldAccessToken) {
			throw new Error('Invalid refresh token');
		}

		const oldTokenData = this.tokens.get(oldAccessToken);
		if (!oldTokenData) {
			throw new Error('Token data not found');
		}

		this.tokens.delete(oldAccessToken);
		this.refreshTokens.delete(refreshToken);

		return this.issueToken(oldTokenData.userId, oldTokenData.scopes, oldTokenData.expiresIn);
	}

	revokeToken(token: string): boolean {
		const tokenData = this.tokens.get(token);
		if (tokenData?.refreshToken) {
			this.refreshTokens.delete(tokenData.refreshToken);
		}
		return this.tokens.delete(token);
	}

	async start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server = createServer((req, res) => this.handleRequest(req, res));

			this.server.on('error', reject);

			this.server.listen(this.port, () => {
				resolve();
			});
		});
	}

	async stop(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.server) {
				resolve();
				return;
			}

			this.server.close((err) => {
				if (err) {
					reject(err);
				} else {
					this.server = null;
					resolve();
				}
			});
		});
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url || '', `http://localhost:${this.port}`);

		res.setHeader('Content-Type', 'application/json');

		if (url.pathname === '/oauth/token' && req.method === 'POST') {
			await this.handleTokenRequest(req, res);
		} else if (url.pathname === '/oauth/introspect' && req.method === 'POST') {
			await this.handleIntrospectRequest(req, res);
		} else if (url.pathname === '/oauth/userinfo' && req.method === 'GET') {
			await this.handleUserInfoRequest(req, res);
		} else {
			res.statusCode = 404;
			res.end(JSON.stringify({ error: 'Not found' }));
		}
	}

	private async handleTokenRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const body = await this.readBody(req);
		const params = new URLSearchParams(body);

		const grantType = params.get('grant_type');

		if (grantType === 'refresh_token') {
			const refreshToken = params.get('refresh_token');
			if (!refreshToken) {
				res.statusCode = 400;
				res.end(JSON.stringify({ error: 'invalid_request' }));
				return;
			}

			try {
				const tokenResponse = await this.refresh(refreshToken);
				res.statusCode = 200;
				res.end(JSON.stringify(tokenResponse));
			} catch (error) {
				res.statusCode = 400;
				res.end(JSON.stringify({ error: 'invalid_grant' }));
			}
		} else {
			res.statusCode = 400;
			res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
		}
	}

	private async handleIntrospectRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const body = await this.readBody(req);
		const params = new URLSearchParams(body);
		const token = params.get('token');

		if (!token) {
			res.statusCode = 400;
			res.end(JSON.stringify({ error: 'invalid_request' }));
			return;
		}

		const tokenInfo = await this.introspect(token);
		res.statusCode = 200;
		res.end(
			JSON.stringify({
				active: tokenInfo.valid,
				scope: tokenInfo.scopes?.join(' '),
				user_id: tokenInfo.userId,
				exp: tokenInfo.expiresAt ? Math.floor(tokenInfo.expiresAt / 1000) : undefined,
			})
		);
	}

	private async handleUserInfoRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const authHeader = req.headers.authorization;
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			res.statusCode = 401;
			res.end(JSON.stringify({ error: 'unauthorized' }));
			return;
		}

		const token = authHeader.substring(7);
		const tokenInfo = await this.introspect(token);

		if (!tokenInfo.valid) {
			res.statusCode = 401;
			res.end(JSON.stringify({ error: 'invalid_token' }));
			return;
		}

		res.statusCode = 200;
		res.end(
			JSON.stringify({
				user_id: tokenInfo.userId,
				scopes: tokenInfo.scopes,
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
