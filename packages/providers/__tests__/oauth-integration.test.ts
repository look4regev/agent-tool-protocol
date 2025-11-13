import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScopeCheckerRegistry } from '../src/oauth/scope-checkers.js';
import type { AuthProvider, UserCredentialData } from '@mondaydotcomorg/atp-protocol';

// Mock fetch globally
global.fetch = vi.fn();

// Mock Auth Provider
class MockAuthProvider implements AuthProvider {
	name = 'mock';
	private userCredentials = new Map<string, Map<string, UserCredentialData>>();

	async getCredential(key: string): Promise<string | null> {
		return process.env[key] || null;
	}

	async setCredential(key: string, value: string): Promise<void> {}

	async deleteCredential(key: string): Promise<void> {}

	async getUserCredential(userId: string, provider: string): Promise<UserCredentialData | null> {
		const userMap = this.userCredentials.get(userId);
		const creds = userMap?.get(provider);

		if (!creds) {
			return null;
		}

		// Check expiration
		if (creds.expiresAt && creds.expiresAt < Date.now()) {
			return null;
		}

		return creds;
	}

	async setUserCredential(
		userId: string,
		provider: string,
		data: UserCredentialData
	): Promise<void> {
		if (!this.userCredentials.has(userId)) {
			this.userCredentials.set(userId, new Map());
		}
		this.userCredentials.get(userId)!.set(provider, data);
	}

	async deleteUserCredential(userId: string, provider: string): Promise<void> {
		this.userCredentials.get(userId)?.delete(provider);
	}

	async listUserProviders(userId: string): Promise<string[]> {
		const userMap = this.userCredentials.get(userId);
		return userMap ? Array.from(userMap.keys()) : [];
	}
}

// Mock scope checkers for testing
class TestGitHubChecker {
	provider = 'github';
	async check(token: string) {
		const response = await fetch('https://api.github.com/user', {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!response.ok) {
			throw new Error('Invalid or expired GitHub token');
		}
		const scopesHeader = response.headers.get('X-OAuth-Scopes');
		return scopesHeader ? scopesHeader.split(',').map((s) => s.trim()) : [];
	}
	async validate(token: string) {
		try {
			const response = await fetch('https://api.github.com/user', {
				headers: { Authorization: `Bearer ${token}` },
			});
			return response.ok;
		} catch {
			return false;
		}
	}
}

class TestGoogleChecker {
	provider = 'google';
	async check(token: string) {
		const response = await fetch(
			`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
		);
		if (!response.ok) {
			throw new Error('Invalid or expired Google token');
		}
		const data = (await response.json()) as { scope?: string; exp?: number };
		return data.scope ? data.scope.split(' ') : [];
	}
	async validate(token: string) {
		try {
			const response = await fetch(
				`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
			);
			return response.ok;
		} catch {
			return false;
		}
	}
}

describe('OAuth Integration Tests', () => {
	let scopeChecker: ScopeCheckerRegistry;
	let authProvider: MockAuthProvider;

	beforeEach(() => {
		scopeChecker = new ScopeCheckerRegistry();
		// Register test checkers
		scopeChecker.register(new TestGitHubChecker() as any);
		scopeChecker.register(new TestGoogleChecker() as any);

		authProvider = new MockAuthProvider();
		vi.clearAllMocks();
	});

	afterEach(() => {
		scopeChecker.stopCleanup();
	});

	describe('End-to-end OAuth connection flow', () => {
		it('should validate and store GitHub credentials', async () => {
			const userId = 'user123';
			const provider = 'github';
			const accessToken = 'gho_test_token';

			// Mock GitHub API responses
			(global.fetch as any)
				.mockResolvedValueOnce({
					// check() call
					ok: true,
					headers: {
						get: (name: string) => (name === 'X-OAuth-Scopes' ? 'repo, read:user' : null),
					},
				})
				.mockResolvedValueOnce({
					// validate() call
					ok: true,
				});

			// Validate token
			const tokenInfo = await scopeChecker.getTokenInfo(provider, accessToken);

			expect(tokenInfo.valid).toBe(true);
			expect(tokenInfo.scopes).toEqual(['repo', 'read:user']);

			// Store credentials
			await authProvider.setUserCredential(userId, provider, {
				token: accessToken,
				scopes: tokenInfo.scopes,
				expiresAt: Date.now() + 3600000,
			});

			// Retrieve credentials
			const storedCreds = await authProvider.getUserCredential(userId, provider);

			expect(storedCreds).not.toBeNull();
			expect(storedCreds?.token).toBe(accessToken);
			expect(storedCreds?.scopes).toEqual(['repo', 'read:user']);
		});

		it('should reject invalid tokens', async () => {
			const provider = 'github';
			const invalidToken = 'invalid_token';

			// Mock GitHub API error
			(global.fetch as any).mockResolvedValueOnce({
				ok: false,
				status: 401,
				statusText: 'Unauthorized',
			});

			await expect(scopeChecker.getTokenInfo(provider, invalidToken)).rejects.toThrow(
				'Invalid or expired GitHub token'
			);
		});

		it('should handle Google OAuth flow with expiration', async () => {
			const userId = 'user123';
			const provider = 'google';
			const accessToken = 'ya29.test_token';

			const now = Math.floor(Date.now() / 1000);
			const expiresIn = 3600; // 1 hour

			// Mock Google tokeninfo
			(global.fetch as any)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						scope: 'https://www.googleapis.com/auth/calendar',
						exp: now + expiresIn,
					}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						exp: now + expiresIn,
					}),
				});

			const tokenInfo = await scopeChecker.getTokenInfo(provider, accessToken);

			expect(tokenInfo.valid).toBe(true);
			expect(tokenInfo.scopes).toEqual(['https://www.googleapis.com/auth/calendar']);

			// Store with expiration
			await authProvider.setUserCredential(userId, provider, {
				token: accessToken,
				scopes: tokenInfo.scopes,
				expiresAt: (now + expiresIn) * 1000, // Convert to milliseconds
			});

			// Should be retrievable immediately
			const creds = await authProvider.getUserCredential(userId, provider);
			expect(creds).not.toBeNull();
		});
	});

	describe('Multi-user scenarios', () => {
		it('should handle multiple users with same provider', async () => {
			const provider = 'github';

			// Mock API responses for both users
			(global.fetch as any)
				.mockResolvedValueOnce({
					ok: true,
					headers: {
						get: (name: string) => (name === 'X-OAuth-Scopes' ? 'repo' : null),
					},
				})
				.mockResolvedValueOnce({
					ok: true,
				})
				.mockResolvedValueOnce({
					ok: true,
					headers: {
						get: (name: string) => (name === 'X-OAuth-Scopes' ? 'read:user' : null),
					},
				})
				.mockResolvedValueOnce({
					ok: true,
				});

			// User 1 connects
			const token1Info = await scopeChecker.getTokenInfo(provider, 'token1');
			await authProvider.setUserCredential('user1', provider, {
				token: 'token1',
				scopes: token1Info.scopes,
			});

			// User 2 connects
			const token2Info = await scopeChecker.getTokenInfo(provider, 'token2');
			await authProvider.setUserCredential('user2', provider, {
				token: 'token2',
				scopes: token2Info.scopes,
			});

			// Verify both users have different credentials
			const user1Creds = await authProvider.getUserCredential('user1', provider);
			const user2Creds = await authProvider.getUserCredential('user2', provider);

			expect(user1Creds?.token).toBe('token1');
			expect(user1Creds?.scopes).toEqual(['repo']);

			expect(user2Creds?.token).toBe('token2');
			expect(user2Creds?.scopes).toEqual(['read:user']);
		});

		it('should handle user with multiple providers', async () => {
			const userId = 'user123';

			// Mock GitHub
			(global.fetch as any)
				.mockResolvedValueOnce({
					ok: true,
					headers: {
						get: (name: string) => (name === 'X-OAuth-Scopes' ? 'repo' : null),
					},
				})
				.mockResolvedValueOnce({
					ok: true,
				});

			const githubInfo = await scopeChecker.getTokenInfo('github', 'github_token');
			await authProvider.setUserCredential(userId, 'github', {
				token: 'github_token',
				scopes: githubInfo.scopes,
			});

			// Mock Google
			(global.fetch as any)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						scope: 'https://www.googleapis.com/auth/calendar',
						exp: Math.floor(Date.now() / 1000) + 3600,
					}),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						exp: Math.floor(Date.now() / 1000) + 3600,
					}),
				});

			const googleInfo = await scopeChecker.getTokenInfo('google', 'google_token');
			await authProvider.setUserCredential(userId, 'google', {
				token: 'google_token',
				scopes: googleInfo.scopes,
			});

			// List providers
			const providers = await authProvider.listUserProviders(userId);

			expect(providers).toEqual(expect.arrayContaining(['github', 'google']));
			expect(providers.length).toBe(2);
		});
	});

	describe('Token disconnection', () => {
		it('should remove provider credentials', async () => {
			const userId = 'user123';
			const provider = 'github';

			// Connect
			await authProvider.setUserCredential(userId, provider, {
				token: 'token',
				scopes: ['repo'],
			});

			// Verify connected
			const beforeDisconnect = await authProvider.getUserCredential(userId, provider);
			expect(beforeDisconnect).not.toBeNull();

			// Disconnect
			await authProvider.deleteUserCredential(userId, provider);

			// Verify disconnected
			const afterDisconnect = await authProvider.getUserCredential(userId, provider);
			expect(afterDisconnect).toBeNull();
		});

		it('should only remove specified provider', async () => {
			const userId = 'user123';

			// Connect multiple providers
			await authProvider.setUserCredential(userId, 'github', {
				token: 'github_token',
				scopes: ['repo'],
			});

			await authProvider.setUserCredential(userId, 'google', {
				token: 'google_token',
				scopes: ['calendar'],
			});

			// Disconnect only GitHub
			await authProvider.deleteUserCredential(userId, 'github');

			// Verify GitHub is gone but Google remains
			const githubCreds = await authProvider.getUserCredential(userId, 'github');
			const googleCreds = await authProvider.getUserCredential(userId, 'google');

			expect(githubCreds).toBeNull();
			expect(googleCreds).not.toBeNull();
			expect(googleCreds?.token).toBe('google_token');
		});
	});

	describe('Scope caching behavior', () => {
		it('should cache scope checks across requests', async () => {
			const provider = 'github';
			const token = 'gho_test_token';

			// Mock single API call
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				headers: {
					get: (name: string) => (name === 'X-OAuth-Scopes' ? 'repo' : null),
				},
			});

			// Make multiple requests
			await scopeChecker.checkScopes(provider, token);
			await scopeChecker.checkScopes(provider, token);
			await scopeChecker.checkScopes(provider, token);

			// Should only call API once
			expect(global.fetch).toHaveBeenCalledTimes(1);
		});

		it('should respect cache TTL', async () => {
			vi.useFakeTimers();

			const provider = 'github';
			const token = 'gho_test_token';

			// Mock API responses
			(global.fetch as any).mockResolvedValue({
				ok: true,
				headers: {
					get: (name: string) => (name === 'X-OAuth-Scopes' ? 'repo' : null),
				},
			});

			// First call
			await scopeChecker.checkScopes(provider, token, 1); // 1 second TTL
			expect(global.fetch).toHaveBeenCalledTimes(1);

			// Within TTL - should use cache
			await scopeChecker.checkScopes(provider, token, 1);
			expect(global.fetch).toHaveBeenCalledTimes(1);

			// Advance time past TTL
			vi.advanceTimersByTime(2000);

			// Should make new API call
			await scopeChecker.checkScopes(provider, token, 1);
			expect(global.fetch).toHaveBeenCalledTimes(2);

			vi.useRealTimers();
		});
	});

	describe('Error handling', () => {
		it('should handle network errors gracefully', async () => {
			(global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

			await expect(scopeChecker.checkScopes('github', 'token')).rejects.toThrow('Network error');
		});

		it('should handle malformed API responses', async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => {
					throw new Error('Invalid JSON');
				},
			});

			await expect(scopeChecker.checkScopes('google', 'token')).rejects.toThrow();
		});

		it('should handle missing provider gracefully', async () => {
			const userId = 'user123';
			const nonexistentProvider = 'nonexistent';

			const creds = await authProvider.getUserCredential(userId, nonexistentProvider);

			expect(creds).toBeNull();
		});
	});
});
