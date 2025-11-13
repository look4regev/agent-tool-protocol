/**
 * Token Refresh Example
 *
 * Demonstrates how to use preRequestHook to automatically refresh
 * short-lived authentication tokens (e.g., 3-minute TTL bearer tokens)
 */

import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import type { ClientHooks } from '@mondaydotcomorg/atp-client';

/**
 * Token Manager - Handles token lifecycle with caching
 */
class TokenManager {
	private currentToken: string | null = null;
	private tokenExpiry: number = 0;
	private refreshPromise: Promise<void> | null = null;

	constructor(
		private authEndpoint: string,
		private credentials: { clientId: string; clientSecret: string }
	) {}

	/**
	 * Gets a valid token, refreshing if necessary
	 * Thread-safe: multiple concurrent calls will share the same refresh
	 */
	async getValidToken(): Promise<string> {
		const now = Date.now();

		// Refresh if expired or about to expire (30 second buffer)
		if (!this.currentToken || now >= this.tokenExpiry - 30000) {
			// Prevent multiple concurrent refreshes
			if (!this.refreshPromise) {
				this.refreshPromise = this.refreshToken().finally(() => {
					this.refreshPromise = null;
				});
			}
			await this.refreshPromise;
		}

		return this.currentToken!;
	}

	/**
	 * Refreshes the token by calling the auth service
	 */
	private async refreshToken(): Promise<void> {
		console.log('[TokenManager] Refreshing token...');

		try {
			const response = await fetch(this.authEndpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					grant_type: 'client_credentials',
					client_id: this.credentials.clientId,
					client_secret: this.credentials.clientSecret,
				}),
			});

			if (!response.ok) {
				throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
			}

			const data: any = await response.json();
			this.currentToken = data.access_token;

			// Calculate expiry with buffer
			const expiresIn = data.expires_in || 180; // Default to 3 minutes
			this.tokenExpiry = Date.now() + expiresIn * 1000;

			console.log(`[TokenManager] Token refreshed. Expires in ${expiresIn} seconds`);
		} catch (error) {
			console.error('[TokenManager] Failed to refresh token:', error);
			throw error;
		}
	}

	/**
	 * Simulates getting an initial token (for demo purposes)
	 */
	async initialize(): Promise<void> {
		// For demo: simulate getting initial token
		this.currentToken = 'initial-token-' + Date.now();
		this.tokenExpiry = Date.now() + 180000; // 3 minutes
		console.log('[TokenManager] Initialized with demo token');
	}
}

/**
 * Example: Using ATP Client with automatic token refresh
 */
async function main() {
	// Setup token manager
	const tokenManager = new TokenManager('https://auth.example.com/oauth/token', {
		clientId: process.env.CLIENT_ID || 'demo-client',
		clientSecret: process.env.CLIENT_SECRET || 'demo-secret',
	});

	// Initialize token
	await tokenManager.initialize();

	// Create hooks object with token refresh
	const hooks: ClientHooks = {
		preRequest: async (context) => {
			console.log(`[Hook] ${context.method} ${context.url}`);

			// Get fresh token (will refresh if needed)
			const token = await tokenManager.getValidToken();

			// Return updated headers with fresh token
			return {
				headers: {
					...context.currentHeaders,
					Authorization: `Bearer ${token}`,
					'X-Request-Time': new Date().toISOString(),
				},
			};
		},
	};

	// Create ATP client with hooks
	const client = new AgentToolProtocolClient({
		baseUrl: process.env.ATP_SERVER_URL || 'http://localhost:3333',
		hooks,
	});

	console.log('\n=== Initializing ATP Client ===');
	await client.init({ name: 'token-refresh-example', version: '1.0.0' });

	console.log('\n=== Connecting to Server ===');
	await client.connect();

	console.log('\n=== Executing Code ===');
	const result = await client.execute(`
		// Example code that uses ATP tools
		const result = {
			timestamp: Date.now(),
			message: "Hello from ATP with auto-refreshed token!"
		};
		return result;
	`);

	console.log('\n=== Execution Result ===');
	console.log(JSON.stringify(result, null, 2));

	console.log('\n=== Getting Server Info ===');
	const info = await client.getServerInfo();
	console.log('Server version:', info.version);

	console.log('\n✅ All requests completed with automatic token refresh!');
}

// Run example
main().catch((error) => {
	console.error('Error:', error);
	process.exit(1);
});
