import { describe, it, expect, beforeEach } from 'vitest';
import { SearchEngine } from '../src/search/index.js';
import type {
	APIGroupConfig,
	AuthProvider,
	UserCredentialData,
	ScopeFilteringConfig,
} from '@mondaydotcomorg/atp-protocol';

// Mock AuthProvider for testing
class MockAuthProvider implements AuthProvider {
	name = 'mock';
	private credentials: Map<string, Map<string, UserCredentialData>> = new Map();

	async getCredential(): Promise<string | null> {
		return null;
	}

	async setCredential(): Promise<void> {}

	async deleteCredential(): Promise<void> {}

	async getUserCredential(userId: string, provider: string): Promise<UserCredentialData | null> {
		const userCreds = this.credentials.get(userId);
		if (!userCreds) return null;
		const cred = userCreds.get(provider);
		if (!cred) return null;

		// Check if token is expired
		if (cred.expiresAt && cred.expiresAt < Date.now()) {
			return null;
		}

		return cred;
	}

	async setUserCredential(
		userId: string,
		provider: string,
		data: UserCredentialData
	): Promise<void> {
		if (!this.credentials.has(userId)) {
			this.credentials.set(userId, new Map());
		}
		this.credentials.get(userId)!.set(provider, data);
	}

	async deleteUserCredential(userId: string, provider: string): Promise<void> {
		const userCreds = this.credentials.get(userId);
		if (userCreds) {
			userCreds.delete(provider);
		}
	}

	async listUserProviders(): Promise<string[]> {
		return [];
	}
}

describe('SearchEngine - Scope Filtering', () => {
	let searchEngine: SearchEngine;
	let authProvider: MockAuthProvider;

	const mockApiGroups: APIGroupConfig[] = [
		{
			name: 'github',
			type: 'custom',
			functions: [
				{
					name: 'listRepos',
					description: 'List all repositories',
					inputSchema: { type: 'object' },
					handler: async () => ({}),
					requiredScopes: ['repo:read'],
					auth: {
						source: 'user',
						oauthProvider: 'github',
					},
				},
				{
					name: 'createIssue',
					description: 'Create a new issue',
					inputSchema: { type: 'object' },
					handler: async () => ({}),
					requiredScopes: ['repo:write', 'issues:write'],
					auth: {
						source: 'user',
						oauthProvider: 'github',
					},
				},
				{
					name: 'getPublicData',
					description: 'Get public data',
					inputSchema: { type: 'object' },
					handler: async () => ({}),
					// No required scopes
					auth: {
						source: 'user',
						oauthProvider: 'github',
					},
				},
			],
		},
		{
			name: 'calendar',
			type: 'custom',
			functions: [
				{
					name: 'listEvents',
					description: 'List calendar events',
					inputSchema: { type: 'object' },
					handler: async () => ({}),
					requiredScopes: ['calendar:read'],
					auth: {
						source: 'user',
						oauthProvider: 'google',
					},
				},
			],
		},
		{
			name: 'server-tools',
			type: 'custom',
			functions: [
				{
					name: 'systemInfo',
					description: 'Get system information',
					inputSchema: { type: 'object' },
					handler: async () => ({}),
					// Server-scoped auth, should not be filtered
					auth: {
						source: 'server',
					},
				},
			],
		},
	];

	beforeEach(() => {
		authProvider = new MockAuthProvider();
		searchEngine = new SearchEngine(mockApiGroups);
	});

	describe('without scope filtering', () => {
		it('should return all matching results', async () => {
			const results = await searchEngine.search({ query: 'repositories' });

			expect(results.length).toBeGreaterThan(0);
			expect(results.some((r) => r.functionName === 'listRepos')).toBe(true);
		});

		it('should match by function name', async () => {
			const results = await searchEngine.search({ query: 'listRepos' });

			expect(results.length).toBeGreaterThan(0);
			const listReposResult = results.find((r) => r.functionName === 'listRepos');
			expect(listReposResult).toBeDefined();
		});
	});

	describe('with scope filtering enabled', () => {
		const scopeConfig: ScopeFilteringConfig = {
			enabled: true,
			mode: 'eager',
			fallback: 'deny',
		};

		it('should filter out functions when user has no credentials', async () => {
			const results = await searchEngine.search(
				{ query: 'list' },
				'user1',
				authProvider,
				scopeConfig
			);

			// Should not include user-scoped functions
			expect(results.some((r) => r.functionName === 'listRepos')).toBe(false);
			expect(results.some((r) => r.functionName === 'createIssue')).toBe(false);
		});

		it('should include functions when user has required scopes', async () => {
			// Set up user with GitHub credentials and scopes
			await authProvider.setUserCredential('user1', 'github', {
				token: 'github-token',
				scopes: ['repo:read', 'repo:write', 'issues:write'],
			});

			const results = await searchEngine.search(
				{ query: 'list' },
				'user1',
				authProvider,
				scopeConfig
			);

			// Should include listRepos (has repo:read scope)
			expect(results.some((r) => r.functionName === 'listRepos')).toBe(true);
		});

		it('should filter out functions when user lacks required scopes', async () => {
			// Set up user with only read scope
			await authProvider.setUserCredential('user1', 'github', {
				token: 'github-token',
				scopes: ['repo:read'],
			});

			const results = await searchEngine.search(
				{ query: 'issue' },
				'user1',
				authProvider,
				scopeConfig
			);

			// Should include listRepos but not createIssue (missing issues:write scope)
			expect(results.some((r) => r.functionName === 'createIssue')).toBe(false);
		});

		it('should include functions with no required scopes', async () => {
			// Set up user with GitHub credentials but no specific scopes
			await authProvider.setUserCredential('user1', 'github', {
				token: 'github-token',
				scopes: [],
			});

			const results = await searchEngine.search(
				{ query: 'public' },
				'user1',
				authProvider,
				scopeConfig
			);

			// Should include getPublicData (no required scopes)
			expect(results.some((r) => r.functionName === 'getPublicData')).toBe(true);
		});

		it('should not filter server-scoped functions', async () => {
			const results = await searchEngine.search(
				{ query: 'system' },
				'user1',
				authProvider,
				scopeConfig
			);

			// Server-scoped functions should always be included
			expect(results.some((r) => r.functionName === 'systemInfo')).toBe(true);
		});

		it('should handle multiple providers correctly', async () => {
			// User has GitHub creds but not Google
			await authProvider.setUserCredential('user1', 'github', {
				token: 'github-token',
				scopes: ['repo:read'],
			});

			const results = await searchEngine.search(
				{ query: 'list' },
				'user1',
				authProvider,
				scopeConfig
			);

			// Should include GitHub functions with proper scopes
			expect(results.some((r) => r.functionName === 'listRepos')).toBe(true);
			// Should not include Google Calendar functions (no credentials)
			expect(results.some((r) => r.functionName === 'listEvents')).toBe(false);
		});

		it('should respect fallback: allow', async () => {
			const allowConfig: ScopeFilteringConfig = {
				enabled: true,
				mode: 'eager',
				fallback: 'allow',
			};

			const results = await searchEngine.search(
				{ query: 'list' },
				'user1',
				authProvider,
				allowConfig
			);

			// With fallback: allow, should include functions even without credentials
			expect(results.some((r) => r.functionName === 'listRepos')).toBe(true);
		});

		it('should respect fallback: deny', async () => {
			const denyConfig: ScopeFilteringConfig = {
				enabled: true,
				mode: 'eager',
				fallback: 'deny',
			};

			const results = await searchEngine.search(
				{ query: 'list' },
				'user1',
				authProvider,
				denyConfig
			);

			// With fallback: deny, should exclude functions without credentials
			expect(results.some((r) => r.functionName === 'listRepos')).toBe(false);
		});

		it('should work without userId', async () => {
			const results = await searchEngine.search({ query: 'list' }, undefined, authProvider, {
				enabled: true,
				mode: 'eager',
				fallback: 'deny',
			});

			// Without userId, should use fallback behavior
			expect(results.some((r) => r.functionName === 'listRepos')).toBe(false);
		});

		it('should work without authProvider with allow fallback', async () => {
			const results = await searchEngine.search({ query: 'list' }, 'user1', undefined, {
				enabled: true,
				mode: 'eager',
				fallback: 'allow',
			});

			// Without authProvider, should use fallback: 'allow' behavior
			expect(results.some((r) => r.functionName === 'listRepos')).toBe(true);
		});

		it('should work without authProvider with deny fallback', async () => {
			const results = await searchEngine.search({ query: 'list' }, 'user1', undefined, {
				enabled: true,
				mode: 'eager',
				fallback: 'deny',
			});

			// Without authProvider, should use fallback: 'deny' behavior
			expect(results.some((r) => r.functionName === 'listRepos')).toBe(false);
		});
	});

	describe('scope checking with edge cases', () => {
		it('should handle expired tokens gracefully', async () => {
			await authProvider.setUserCredential('user1', 'github', {
				token: 'github-token',
				scopes: ['repo:read'],
				expiresAt: Date.now() - 1000, // Expired
			});

			const results = await searchEngine.search({ query: 'list' }, 'user1', authProvider, {
				enabled: true,
				mode: 'eager',
				fallback: 'deny',
			});

			// Expired tokens are treated as no credentials by AuthProvider
			// So with fallback: 'deny', functions should be excluded
			expect(results.some((r) => r.functionName === 'listRepos')).toBe(false);
		});

		it('should include functions with valid (non-expired) tokens', async () => {
			await authProvider.setUserCredential('user1', 'github', {
				token: 'github-token',
				scopes: ['repo:read'],
				expiresAt: Date.now() + 3600000, // Expires in 1 hour
			});

			const results = await searchEngine.search({ query: 'list' }, 'user1', authProvider, {
				enabled: true,
				mode: 'eager',
				fallback: 'deny',
			});

			// Valid tokens should allow access
			expect(results.some((r) => r.functionName === 'listRepos')).toBe(true);
		});

		it('should handle case-sensitive scope matching', async () => {
			await authProvider.setUserCredential('user1', 'github', {
				token: 'github-token',
				scopes: ['REPO:READ'], // Wrong case
			});

			const results = await searchEngine.search({ query: 'repository' }, 'user1', authProvider, {
				enabled: true,
				mode: 'eager',
				fallback: 'deny',
			});

			// Scopes are case-sensitive, should not match
			expect(results.some((r) => r.functionName === 'listRepos')).toBe(false);
		});

		it('should require all scopes for functions with multiple required scopes', async () => {
			// User has repo:write but not issues:write
			await authProvider.setUserCredential('user1', 'github', {
				token: 'github-token',
				scopes: ['repo:write'],
			});

			const results = await searchEngine.search({ query: 'issue' }, 'user1', authProvider, {
				enabled: true,
				mode: 'eager',
				fallback: 'deny',
			});

			// Should not include createIssue (missing issues:write scope)
			expect(results.some((r) => r.functionName === 'createIssue')).toBe(false);
		});
	});

	describe('search with API group filters', () => {
		it('should combine scope filtering with API group filters', async () => {
			await authProvider.setUserCredential('user1', 'github', {
				token: 'github-token',
				scopes: ['repo:read'],
			});

			const results = await searchEngine.search(
				{ query: 'list', apiGroups: ['github'] },
				'user1',
				authProvider,
				{
					enabled: true,
					mode: 'eager',
					fallback: 'deny',
				}
			);

			// Should only include GitHub functions with proper scopes
			expect(results.some((r) => r.functionName === 'listRepos')).toBe(true);
			expect(results.some((r) => r.functionName === 'listEvents')).toBe(false);
		});
	});
});
