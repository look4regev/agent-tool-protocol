/**
 * Example OAuth Scope Checker Implementations
 *
 * These are vendor-specific implementations that you can use as examples
 * for building your own scope checkers. Copy and customize as needed.
 */

import type { ScopeChecker } from '@agent-tool-protocol/protocol';

/**
 * GitHub scope checker
 * Checks OAuth scopes for GitHub tokens
 */
export class GitHubScopeChecker implements ScopeChecker {
	provider = 'github';

	async check(token: string): Promise<string[]> {
		const response = await fetch('https://api.github.com/user', {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'User-Agent': 'agent-tool-protocol',
			},
		});

		if (!response.ok) {
			if (response.status === 401) {
				throw new Error('Invalid or expired GitHub token');
			}
			throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
		}

		// GitHub returns scopes in X-OAuth-Scopes header
		const scopesHeader = response.headers.get('X-OAuth-Scopes');
		if (!scopesHeader) {
			return [];
		}

		return scopesHeader
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
	}

	async validate(token: string): Promise<boolean> {
		try {
			const response = await fetch('https://api.github.com/user', {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/vnd.github+json',
					'User-Agent': 'agent-tool-protocol',
				},
			});

			return response.ok;
		} catch (error) {
			return false;
		}
	}
}

/**
 * Google scope checker
 * Checks OAuth scopes for Google tokens
 */
export class GoogleScopeChecker implements ScopeChecker {
	provider = 'google';

	async check(token: string): Promise<string[]> {
		const response = await fetch(
			`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
		);

		if (!response.ok) {
			if (response.status === 400) {
				throw new Error('Invalid or expired Google token');
			}
			throw new Error(`Google tokeninfo error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as { scope?: string; exp?: number };

		if (data.exp && data.exp < Math.floor(Date.now() / 1000)) {
			throw new Error('Google token has expired');
		}

		if (!data.scope) {
			return [];
		}

		return data.scope.split(' ').filter((s) => s.length > 0);
	}

	async validate(token: string): Promise<boolean> {
		try {
			const response = await fetch(
				`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
			);

			if (!response.ok) {
				return false;
			}

			const data = (await response.json()) as { exp?: number };
			if (data.exp) {
				const now = Math.floor(Date.now() / 1000);
				return data.exp > now;
			}

			return true;
		} catch (error) {
			return false;
		}
	}
}

/**
 * Microsoft scope checker
 * Checks OAuth scopes for Microsoft/Azure AD tokens
 */
export class MicrosoftScopeChecker implements ScopeChecker {
	provider = 'microsoft';

	async check(token: string): Promise<string[]> {
		const response = await fetch('https://graph.microsoft.com/v1.0/me', {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		if (!response.ok) {
			if (response.status === 401) {
				throw new Error('Invalid or expired Microsoft token');
			}
			throw new Error(`Microsoft Graph API error: ${response.status} ${response.statusText}`);
		}

		const parts = token.split('.');
		if (parts.length !== 3 || !parts[1]) {
			throw new Error('Invalid Microsoft token format');
		}

		try {
			const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

			if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
				throw new Error('Microsoft token has expired');
			}

			const scopes = payload.scp || payload.scope || '';
			return scopes.split(' ').filter((s: string) => s.length > 0);
		} catch (error) {
			if (error instanceof Error && error.message.includes('expired')) {
				throw error;
			}
			throw new Error('Failed to parse Microsoft token');
		}
	}

	async validate(token: string): Promise<boolean> {
		try {
			const response = await fetch('https://graph.microsoft.com/v1.0/me', {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});

			return response.ok;
		} catch (error) {
			return false;
		}
	}
}

/**
 * Slack scope checker
 * Checks OAuth scopes for Slack tokens
 */
export class SlackScopeChecker implements ScopeChecker {
	provider = 'slack';

	async check(token: string): Promise<string[]> {
		const response = await fetch('https://slack.com/api/auth.test', {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		if (!response.ok) {
			throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as { ok: boolean; error?: string; scopes?: string };

		if (!data.ok) {
			throw new Error(`Slack API error: ${data.error || 'Invalid token'}`);
		}

		if (!data.scopes) {
			return [];
		}

		return data.scopes.split(',').filter((s) => s.length > 0);
	}

	async validate(token: string): Promise<boolean> {
		try {
			const response = await fetch('https://slack.com/api/auth.test', {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});

			if (!response.ok) {
				return false;
			}

			const data = (await response.json()) as { ok: boolean };
			return data.ok;
		} catch (error) {
			return false;
		}
	}
}
