import { describe, it, expect, beforeEach } from 'vitest';
import type { AuthProvider, UserCredentialData } from '@agent-tool-protocol/protocol';

// Test implementation that mimics production behavior
class TestAuthProvider implements AuthProvider {
	name = 'test';
	private userCredentials = new Map<string, Map<string, UserCredentialData>>();

	async getCredential(key: string): Promise<string | null> {
		return null;
	}

	async setCredential(key: string, value: string): Promise<void> {}

	async deleteCredential(key: string): Promise<void> {}

	async getUserCredential(userId: string, provider: string): Promise<UserCredentialData | null> {
		const userMap = this.userCredentials.get(userId);
		const creds = userMap?.get(provider);

		if (!creds) {
			return null;
		}

		// Check if token has expired
		if (creds.expiresAt && creds.expiresAt < Date.now()) {
			// In production, would attempt to refresh here
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

describe('Token Expiration Handling', () => {
	let authProvider: TestAuthProvider;

	beforeEach(() => {
		authProvider = new TestAuthProvider();
	});

	describe('getUserCredential with expired token', () => {
		it('should return null for expired token', async () => {
			const userId = 'user123';
			const provider = 'github';

			// Store credential with expired token
			const expiredTime = Date.now() - 3600000; // 1 hour ago
			await authProvider.setUserCredential(userId, provider, {
				token: 'gho_expired_token',
				scopes: ['repo'],
				expiresAt: expiredTime,
			});

			// Should return null due to expiration
			const result = await authProvider.getUserCredential(userId, provider);

			expect(result).toBeNull();
		});

		it('should return credential for non-expired token', async () => {
			const userId = 'user123';
			const provider = 'github';

			// Store credential with valid token
			const futureTime = Date.now() + 3600000; // 1 hour from now
			const credentials: UserCredentialData = {
				token: 'gho_valid_token',
				scopes: ['repo'],
				expiresAt: futureTime,
			};

			await authProvider.setUserCredential(userId, provider, credentials);

			// Should return the credential
			const result = await authProvider.getUserCredential(userId, provider);

			expect(result).toEqual(credentials);
		});

		it('should return credential when no expiration time set', async () => {
			const userId = 'user123';
			const provider = 'github';

			// Store credential without expiration
			const credentials: UserCredentialData = {
				token: 'gho_no_expiry_token',
				scopes: ['repo'],
			};

			await authProvider.setUserCredential(userId, provider, credentials);

			// Should return the credential
			const result = await authProvider.getUserCredential(userId, provider);

			expect(result).toEqual(credentials);
		});

		it('should handle token that expires right at current time', async () => {
			const userId = 'user123';
			const provider = 'github';

			// Store credential that expires exactly now
			const nowTime = Date.now();
			await authProvider.setUserCredential(userId, provider, {
				token: 'gho_expires_now_token',
				scopes: ['repo'],
				expiresAt: nowTime - 1, // Expires 1ms in the past to ensure it's expired
			});

			// Should return null (expired)
			const result = await authProvider.getUserCredential(userId, provider);

			expect(result).toBeNull();
		});
	});

	describe('Token refresh scenarios', () => {
		it('should store refresh token when provided', async () => {
			const userId = 'user123';
			const provider = 'google';

			const credentials: UserCredentialData = {
				token: 'ya29.access_token',
				refreshToken: 'refresh_token_here',
				scopes: ['calendar'],
				expiresAt: Date.now() + 3600000,
			};

			await authProvider.setUserCredential(userId, provider, credentials);

			const result = await authProvider.getUserCredential(userId, provider);

			expect(result?.refreshToken).toBe('refresh_token_here');
		});

		it('should handle credentials without refresh token', async () => {
			const userId = 'user123';
			const provider = 'github';

			const credentials: UserCredentialData = {
				token: 'gho_token',
				scopes: ['repo'],
				expiresAt: Date.now() + 3600000,
			};

			await authProvider.setUserCredential(userId, provider, credentials);

			const result = await authProvider.getUserCredential(userId, provider);

			expect(result?.refreshToken).toBeUndefined();
		});
	});

	describe('Multiple users with different expiration times', () => {
		it('should handle different expiration times for different users', async () => {
			const provider = 'github';

			// User 1: expired token
			await authProvider.setUserCredential('user1', provider, {
				token: 'token1',
				scopes: ['repo'],
				expiresAt: Date.now() - 1000, // Expired
			});

			// User 2: valid token
			await authProvider.setUserCredential('user2', provider, {
				token: 'token2',
				scopes: ['repo'],
				expiresAt: Date.now() + 3600000, // Valid
			});

			const user1Creds = await authProvider.getUserCredential('user1', provider);
			const user2Creds = await authProvider.getUserCredential('user2', provider);

			expect(user1Creds).toBeNull(); // Expired
			expect(user2Creds).not.toBeNull(); // Valid
			expect(user2Creds?.token).toBe('token2');
		});

		it('should handle same user with multiple providers at different expiration states', async () => {
			const userId = 'user123';

			// GitHub: expired
			await authProvider.setUserCredential(userId, 'github', {
				token: 'github_token',
				scopes: ['repo'],
				expiresAt: Date.now() - 1000,
			});

			// Google: valid
			await authProvider.setUserCredential(userId, 'google', {
				token: 'google_token',
				scopes: ['calendar'],
				expiresAt: Date.now() + 3600000,
			});

			const githubCreds = await authProvider.getUserCredential(userId, 'github');
			const googleCreds = await authProvider.getUserCredential(userId, 'google');

			expect(githubCreds).toBeNull();
			expect(googleCreds).not.toBeNull();
			expect(googleCreds?.token).toBe('google_token');
		});
	});

	describe('Token metadata handling', () => {
		it('should preserve metadata with expired tokens', async () => {
			const userId = 'user123';
			const provider = 'github';

			await authProvider.setUserCredential(userId, provider, {
				token: 'token',
				scopes: ['repo'],
				expiresAt: Date.now() + 3600000,
				metadata: {
					username: 'octocat',
					userId: 'github_123',
				},
			});

			const result = await authProvider.getUserCredential(userId, provider);

			expect(result?.metadata).toEqual({
				username: 'octocat',
				userId: 'github_123',
			});
		});

		it('should handle credentials with complex metadata', async () => {
			const userId = 'user123';
			const provider = 'microsoft';

			const complexMetadata = {
				tenantId: 'tenant-id',
				objectId: 'object-id',
				permissions: ['User.Read', 'Mail.Send'],
				nested: {
					data: {
						value: 123,
					},
				},
			};

			await authProvider.setUserCredential(userId, provider, {
				token: 'token',
				scopes: ['User.Read'],
				expiresAt: Date.now() + 3600000,
				metadata: complexMetadata,
			});

			const result = await authProvider.getUserCredential(userId, provider);

			expect(result?.metadata).toEqual(complexMetadata);
		});
	});

	describe('Scope management', () => {
		it('should handle empty scopes array', async () => {
			const userId = 'user123';
			const provider = 'github';

			await authProvider.setUserCredential(userId, provider, {
				token: 'token',
				scopes: [],
				expiresAt: Date.now() + 3600000,
			});

			const result = await authProvider.getUserCredential(userId, provider);

			expect(result?.scopes).toEqual([]);
		});

		it('should handle undefined scopes', async () => {
			const userId = 'user123';
			const provider = 'github';

			await authProvider.setUserCredential(userId, provider, {
				token: 'token',
				expiresAt: Date.now() + 3600000,
			});

			const result = await authProvider.getUserCredential(userId, provider);

			expect(result?.scopes).toBeUndefined();
		});
	});
});
