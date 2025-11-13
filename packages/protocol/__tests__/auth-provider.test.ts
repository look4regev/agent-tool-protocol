import { describe, it, expect, beforeEach } from 'vitest';
import type { AuthProvider, UserCredentialData } from '@mondaydotcomorg/atp-protocol';

// Mock in-memory implementation for testing
class MockAuthProvider implements AuthProvider {
	name = 'mock';
	private serverCredentials = new Map<string, string>();
	private userCredentials = new Map<string, Map<string, UserCredentialData>>();

	async getCredential(key: string): Promise<string | null> {
		return this.serverCredentials.get(key) || null;
	}

	async setCredential(key: string, value: string): Promise<void> {
		this.serverCredentials.set(key, value);
	}

	async deleteCredential(key: string): Promise<void> {
		this.serverCredentials.delete(key);
	}

	async getUserCredential(userId: string, provider: string): Promise<UserCredentialData | null> {
		const userMap = this.userCredentials.get(userId);
		return userMap?.get(provider) || null;
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

describe('AuthProvider User Credentials', () => {
	let authProvider: MockAuthProvider;

	beforeEach(() => {
		authProvider = new MockAuthProvider();
	});

	describe('User-scoped credentials', () => {
		it('should store and retrieve user credentials', async () => {
			const userId = 'user123';
			const provider = 'github';
			const credentials: UserCredentialData = {
				token: 'gho_test_token',
				scopes: ['repo', 'read:user'],
				expiresAt: Date.now() + 3600000,
			};

			await authProvider.setUserCredential(userId, provider, credentials);
			const retrieved = await authProvider.getUserCredential(userId, provider);

			expect(retrieved).toEqual(credentials);
		});

		it('should return null for non-existent user credentials', async () => {
			const result = await authProvider.getUserCredential('user123', 'github');
			expect(result).toBeNull();
		});

		it('should delete user credentials', async () => {
			const userId = 'user123';
			const provider = 'github';
			const credentials: UserCredentialData = {
				token: 'gho_test_token',
				scopes: ['repo'],
			};

			await authProvider.setUserCredential(userId, provider, credentials);
			await authProvider.deleteUserCredential(userId, provider);

			const result = await authProvider.getUserCredential(userId, provider);
			expect(result).toBeNull();
		});

		it('should list providers for a user', async () => {
			const userId = 'user123';

			await authProvider.setUserCredential(userId, 'github', {
				token: 'token1',
				scopes: ['repo'],
			});

			await authProvider.setUserCredential(userId, 'google', {
				token: 'token2',
				scopes: ['calendar'],
			});

			const providers = await authProvider.listUserProviders(userId);
			expect(providers).toEqual(expect.arrayContaining(['github', 'google']));
			expect(providers.length).toBe(2);
		});

		it('should handle multiple users independently', async () => {
			await authProvider.setUserCredential('user1', 'github', {
				token: 'token_user1',
				scopes: ['repo'],
			});

			await authProvider.setUserCredential('user2', 'github', {
				token: 'token_user2',
				scopes: ['read:user'],
			});

			const user1Creds = await authProvider.getUserCredential('user1', 'github');
			const user2Creds = await authProvider.getUserCredential('user2', 'github');

			expect(user1Creds?.token).toBe('token_user1');
			expect(user1Creds?.scopes).toEqual(['repo']);

			expect(user2Creds?.token).toBe('token_user2');
			expect(user2Creds?.scopes).toEqual(['read:user']);
		});

		it('should store refresh tokens', async () => {
			const credentials: UserCredentialData = {
				token: 'access_token',
				refreshToken: 'refresh_token',
				scopes: ['repo'],
				expiresAt: Date.now() + 3600000,
			};

			await authProvider.setUserCredential('user123', 'github', credentials);
			const retrieved = await authProvider.getUserCredential('user123', 'github');

			expect(retrieved?.refreshToken).toBe('refresh_token');
		});

		it('should store metadata', async () => {
			const credentials: UserCredentialData = {
				token: 'token',
				scopes: ['repo'],
				metadata: {
					userId: 'github_user_id',
					username: 'octocat',
				},
			};

			await authProvider.setUserCredential('user123', 'github', credentials);
			const retrieved = await authProvider.getUserCredential('user123', 'github');

			expect(retrieved?.metadata).toEqual({
				userId: 'github_user_id',
				username: 'octocat',
			});
		});
	});

	describe('Server-level credentials', () => {
		it('should store and retrieve server credentials', async () => {
			await authProvider.setCredential('SERVER_API_KEY', 'secret_key');
			const retrieved = await authProvider.getCredential('SERVER_API_KEY');

			expect(retrieved).toBe('secret_key');
		});

		it('should delete server credentials', async () => {
			await authProvider.setCredential('KEY', 'value');
			await authProvider.deleteCredential('KEY');

			const result = await authProvider.getCredential('KEY');
			expect(result).toBeNull();
		});

		it('should keep server and user credentials separate', async () => {
			// Server-level credential
			await authProvider.setCredential('SERVER_KEY', 'server_value');

			// User-level credential
			await authProvider.setUserCredential('user123', 'github', {
				token: 'user_token',
				scopes: ['repo'],
			});

			// Both should be retrievable independently
			const serverCred = await authProvider.getCredential('SERVER_KEY');
			const userCred = await authProvider.getUserCredential('user123', 'github');

			expect(serverCred).toBe('server_value');
			expect(userCred?.token).toBe('user_token');
		});
	});
});
