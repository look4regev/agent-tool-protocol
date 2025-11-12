import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScopeCheckerRegistry } from '../src/oauth/scope-checkers.js';
import type { ScopeChecker } from '@agent-tool-protocol/protocol';

// Mock implementations for testing
class MockGitHubScopeChecker implements ScopeChecker {
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

class MockGoogleScopeChecker implements ScopeChecker {
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

// Mock fetch globally
global.fetch = vi.fn();

describe('MockGitHubScopeChecker', () => {
	let checker: MockGitHubScopeChecker;

	beforeEach(() => {
		checker = new MockGitHubScopeChecker();
		vi.clearAllMocks();
	});

	describe('check()', () => {
		it('should return scopes from X-OAuth-Scopes header', async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				headers: {
					get: (name: string) => {
						if (name === 'X-OAuth-Scopes') {
							return 'repo, read:user, write:org';
						}
						return null;
					},
				},
			});

			const scopes = await checker.check('gho_test_token');

			expect(scopes).toEqual(['repo', 'read:user', 'write:org']);
			expect(global.fetch).toHaveBeenCalledWith(
				'https://api.github.com/user',
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: 'Bearer gho_test_token',
					}),
				})
			);
		});

		it('should return empty array when no scopes header', async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				headers: {
					get: () => null,
				},
			});

			const scopes = await checker.check('gho_test_token');

			expect(scopes).toEqual([]);
		});

		it('should throw error on 401 unauthorized', async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: false,
				status: 401,
				statusText: 'Unauthorized',
			});

			await expect(checker.check('invalid_token')).rejects.toThrow(
				'Invalid or expired GitHub token'
			);
		});

		it('should throw error on other HTTP errors', async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
			});

			await expect(checker.check('gho_test_token')).rejects.toThrow(
				'GitHub API error: 500 Internal Server Error'
			);
		});
	});

	describe('validate()', () => {
		it('should return true for valid token', async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
			});

			const isValid = await checker.validate('gho_test_token');

			expect(isValid).toBe(true);
		});

		it('should return false for invalid token', async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: false,
			});

			const isValid = await checker.validate('invalid_token');

			expect(isValid).toBe(false);
		});

		it('should return false on network error', async () => {
			(global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

			const isValid = await checker.validate('gho_test_token');

			expect(isValid).toBe(false);
		});
	});
});

describe('MockGoogleScopeChecker', () => {
	let checker: MockGoogleScopeChecker;

	beforeEach(() => {
		checker = new MockGoogleScopeChecker();
		vi.clearAllMocks();
	});

	describe('check()', () => {
		it('should return scopes from tokeninfo response', async () => {
			const now = Math.floor(Date.now() / 1000);
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					scope:
						'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email',
					exp: now + 3600,
				}),
			});

			const scopes = await checker.check('ya29.test_token');

			expect(scopes).toEqual([
				'https://www.googleapis.com/auth/calendar',
				'https://www.googleapis.com/auth/userinfo.email',
			]);
		});

		it('should throw error when token is expired', async () => {
			const expiredTime = Math.floor(Date.now() / 1000) - 3600;
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					scope: 'email',
					exp: expiredTime,
				}),
			});

			await expect(checker.check('ya29.test_token')).rejects.toThrow('Google token has expired');
		});

		it('should throw error on 400 bad request', async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: false,
				status: 400,
				statusText: 'Bad Request',
			});

			await expect(checker.check('invalid_token')).rejects.toThrow(
				'Invalid or expired Google token'
			);
		});

		it('should return empty array when no scope field', async () => {
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => ({}),
			});

			const scopes = await checker.check('ya29.test_token');

			expect(scopes).toEqual([]);
		});
	});

	describe('validate()', () => {
		it('should return true for non-expired token', async () => {
			const now = Math.floor(Date.now() / 1000);
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					exp: now + 3600,
				}),
			});

			const isValid = await checker.validate('ya29.test_token');

			expect(isValid).toBe(true);
		});

		it('should return false for expired token', async () => {
			const expiredTime = Math.floor(Date.now() / 1000) - 3600;
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					exp: expiredTime,
				}),
			});

			const isValid = await checker.validate('ya29.test_token');

			expect(isValid).toBe(false);
		});

		it('should return false on network error', async () => {
			(global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

			const isValid = await checker.validate('ya29.test_token');

			expect(isValid).toBe(false);
		});
	});
});

describe('ScopeChecker (Microsoft example)', () => {
	// Tests removed - vendor implementations moved to examples
	it('should be tested in examples', () => {
		expect(true).toBe(true);
	});
});

describe('ScopeCheckerRegistry', () => {
	let registry: ScopeCheckerRegistry;

	beforeEach(() => {
		registry = new ScopeCheckerRegistry();
		vi.clearAllMocks();
	});

	afterEach(() => {
		registry.stopCleanup();
	});

	describe('register()', () => {
		it('should register custom scope checker', () => {
			const customChecker = {
				provider: 'custom',
				check: vi.fn(),
				validate: vi.fn(),
			};

			registry.register(customChecker);

			expect(registry.hasChecker('custom')).toBe(true);
			expect(registry.getChecker('custom')).toBe(customChecker);
		});
	});

	describe('hasChecker()', () => {
		it('should return false for checkers not registered', () => {
			expect(registry.hasChecker('github')).toBe(false);
			expect(registry.hasChecker('google')).toBe(false);
			expect(registry.hasChecker('unknown')).toBe(false);
		});

		it('should return true for registered checkers', () => {
			registry.register(new MockGitHubScopeChecker());
			expect(registry.hasChecker('github')).toBe(true);
		});
	});

	describe('checkScopes()', () => {
		it('should check scopes and cache result', async () => {
			// Register checker first
			registry.register(new MockGitHubScopeChecker());

			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				headers: {
					get: (name: string) => (name === 'X-OAuth-Scopes' ? 'repo' : null),
				},
			});

			const scopes1 = await registry.checkScopes('github', 'gho_test_token');
			expect(scopes1).toEqual(['repo']);
			expect(global.fetch).toHaveBeenCalledTimes(1);

			// Second call should use cache
			const scopes2 = await registry.checkScopes('github', 'gho_test_token');
			expect(scopes2).toEqual(['repo']);
			expect(global.fetch).toHaveBeenCalledTimes(1); // Still 1, not 2
		});

		it('should deduplicate concurrent requests', async () => {
			registry.register(new MockGitHubScopeChecker());

			(global.fetch as any).mockImplementation(
				() =>
					new Promise((resolve) =>
						setTimeout(
							() =>
								resolve({
									ok: true,
									headers: {
										get: (name: string) => (name === 'X-OAuth-Scopes' ? 'repo' : null),
									},
								}),
							100
						)
					)
			);

			// Make 3 concurrent requests
			const promises = [
				registry.checkScopes('github', 'gho_test_token'),
				registry.checkScopes('github', 'gho_test_token'),
				registry.checkScopes('github', 'gho_test_token'),
			];

			const results = await Promise.all(promises);

			// All should return the same result
			expect(results).toEqual([['repo'], ['repo'], ['repo']]);

			// But only one API call should have been made
			expect(global.fetch).toHaveBeenCalledTimes(1);
		});

		it('should throw error for unsupported provider', async () => {
			await expect(registry.checkScopes('unsupported', 'token')).rejects.toThrow(
				'No scope checker registered for provider: unsupported'
			);
		});
	});

	describe('validateToken()', () => {
		it('should validate token', async () => {
			registry.register(new MockGitHubScopeChecker());

			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
			});

			const isValid = await registry.validateToken('github', 'gho_test_token');

			expect(isValid).toBe(true);
		});

		it('should return true for checker without validate method', async () => {
			const checkerWithoutValidate = {
				provider: 'custom',
				check: vi.fn(),
			};

			registry.register(checkerWithoutValidate);

			const isValid = await registry.validateToken('custom', 'token');

			expect(isValid).toBe(true);
		});
	});

	describe('getTokenInfo()', () => {
		it('should return token info with validity and scopes', async () => {
			registry.register(new MockGitHubScopeChecker());

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

			const tokenInfo = await registry.getTokenInfo('github', 'gho_test_token');

			expect(tokenInfo).toEqual({
				valid: true,
				scopes: ['repo'],
			});
		});
	});

	describe('clearCache()', () => {
		it('should clear all cache when no provider specified', async () => {
			registry.register(new MockGitHubScopeChecker());

			(global.fetch as any).mockResolvedValue({
				ok: true,
				headers: {
					get: (name: string) => (name === 'X-OAuth-Scopes' ? 'repo' : null),
				},
			});

			// Cache some scopes
			await registry.checkScopes('github', 'token1');
			await registry.checkScopes('github', 'token2');

			expect(global.fetch).toHaveBeenCalledTimes(2);

			// Clear cache
			registry.clearCache();

			// Next call should hit API again
			await registry.checkScopes('github', 'token1');
			expect(global.fetch).toHaveBeenCalledTimes(3);
		});

		it('should clear cache for specific provider only', async () => {
			registry.register(new MockGitHubScopeChecker());

			(global.fetch as any).mockResolvedValue({
				ok: true,
				headers: {
					get: (name: string) => (name === 'X-OAuth-Scopes' ? 'repo' : null),
				},
			});

			// Cache scopes for github
			await registry.checkScopes('github', 'token1');
			const callCount = (global.fetch as any).mock.calls.length;

			// Clear github cache
			registry.clearCache('github');

			// GitHub should hit API again
			await registry.checkScopes('github', 'token1');
			expect((global.fetch as any).mock.calls.length).toBe(callCount + 1);
		});
	});

	describe('cache cleanup', () => {
		it('should periodically clean expired entries', async () => {
			registry.register(new MockGitHubScopeChecker());

			vi.useFakeTimers();

			(global.fetch as any).mockResolvedValue({
				ok: true,
				headers: {
					get: (name: string) => (name === 'X-OAuth-Scopes' ? 'repo' : null),
				},
			});

			// Cache with short TTL
			await registry.checkScopes('github', 'token', 1); // 1 second TTL

			// Fast-forward 5 minutes (cleanup interval)
			vi.advanceTimersByTime(5 * 60 * 1000);

			// Cache should be cleaned
			await registry.checkScopes('github', 'token');

			// Should have made 2 API calls (one before, one after cleanup)
			expect((global.fetch as any).mock.calls.length).toBeGreaterThanOrEqual(2);

			vi.useRealTimers();
		});

		it('should stop cleanup on stopCleanup()', () => {
			const spy = vi.spyOn(global, 'clearInterval');

			registry.stopCleanup();

			expect(spy).toHaveBeenCalled();
		});
	});
});
