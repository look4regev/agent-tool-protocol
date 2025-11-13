/**
 * Example: OAuth Flow with User-Scoped Credentials
 *
 * This example demonstrates how to:
 * 1. Build a UI where users connect their OAuth accounts
 * 2. Store user credentials in a database
 * 3. Configure ATP server to use user-scoped credentials
 * 4. Automatically filter tools based on user's OAuth scopes
 */

import { createServer } from '@agent-tool-protocol/server';
import { ScopeCheckerRegistry } from '@agent-tool-protocol/providers';
import type { AuthProvider, UserCredentialData } from '@mondaydotcomorg/atp-protocol';
import express, { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import {
	GitHubScopeChecker,
	GoogleScopeChecker,
	MicrosoftScopeChecker,
	SlackScopeChecker,
} from './scope-checker-implementations.js';

// ===== TYPE EXTENSIONS =====

declare global {
	namespace Express {
		interface Request {
			userId?: string;
			csrfToken?: string;
		}
	}
}

// ===== 1. IN-MEMORY STORAGE (Mock Database) =====

/**
 * In a real application, replace this with actual database storage:
 * - PostgreSQL: Use pg library with user_credentials table
 * - MongoDB: Store in users collection with credentials array
 * - Redis: Store as hash with userId:provider as key
 * - Any other database of your choice
 */
const inMemoryStorage = new Map<string, Map<string, UserCredentialData>>();

// CSRF token storage (in production, use Redis or similar)
const csrfTokens = new Map<string, number>(); // token -> expiry timestamp

// ===== 2. CUSTOM AUTH PROVIDER (In-Memory) =====

class InMemoryAuthProvider implements AuthProvider {
	name = 'memory';

	// Server-level credentials (from env)
	async getCredential(key: string): Promise<string | null> {
		return process.env[key] || null;
	}

	async setCredential(key: string, value: string): Promise<void> {
		// Not implemented for this example
	}

	async deleteCredential(key: string): Promise<void> {
		// Not implemented for this example
	}

	// User-scoped credentials (from in-memory storage)
	// In production: Query your database instead
	async getUserCredential(userId: string, provider: string): Promise<UserCredentialData | null> {
		const userMap = inMemoryStorage.get(userId);
		const creds = userMap?.get(provider);

		if (!creds) {
			return null;
		}

		// Check if token has expired
		if (creds.expiresAt && creds.expiresAt < Date.now()) {
			// TODO: In production, implement automatic token refresh here
			// if (creds.refreshToken) {
			//   const refreshed = await refreshToken(provider, creds.refreshToken);
			//   await this.setUserCredential(userId, provider, refreshed);
			//   return refreshed;
			// }

			// Token expired and no refresh token or refresh failed
			console.warn(`Token expired for user ${userId}, provider ${provider}`);
			return null;
		}

		return creds;
	}

	// In production: INSERT/UPDATE to your database
	async setUserCredential(
		userId: string,
		provider: string,
		data: UserCredentialData
	): Promise<void> {
		if (!inMemoryStorage.has(userId)) {
			inMemoryStorage.set(userId, new Map());
		}
		inMemoryStorage.get(userId)!.set(provider, data);

		console.log(
			`✅ Stored credentials for user ${userId}, provider ${provider} (token: ***${data.token.slice(-4)})`
		);
	}

	// In production: DELETE from your database
	async deleteUserCredential(userId: string, provider: string): Promise<void> {
		inMemoryStorage.get(userId)?.delete(provider);
		console.log(`🗑️  Deleted credentials for user ${userId}, provider ${provider}`);
	}

	// In production: SELECT DISTINCT provider FROM user_credentials WHERE user_id = ?
	async listUserProviders(userId: string): Promise<string[]> {
		const userMap = inMemoryStorage.get(userId);
		return userMap ? Array.from(userMap.keys()) : [];
	}
}

// ===== 3. UTILITY FUNCTIONS =====

/**
 * Input validation utilities
 */
const validators = {
	providerName: (name: string): boolean => {
		return /^[a-z][a-z0-9_-]{0,50}$/i.test(name);
	},
	tokenFormat: (token: string, provider: string): boolean => {
		// Basic token validation - adjust per provider
		const patterns: Record<string, RegExp> = {
			github: /^(gho|ghp)_[A-Za-z0-9]{36,255}$/,
			google: /^ya29\.[A-Za-z0-9_-]+$/,
			microsoft: /^[A-Za-z0-9._-]{50,2048}$/, // JWT tokens
			slack: /^xoxp-[0-9]+-[0-9]+-[0-9]+-[a-f0-9]{32}$/,
		};

		const pattern = patterns[provider];
		if (!pattern) {
			// Unknown provider - use generic validation
			return token.length >= 20 && token.length <= 2048;
		}

		return pattern.test(token);
	},
};

/**
 * CSRF token generation and validation
 */
function generateCSRFToken(): string {
	const token = randomBytes(32).toString('hex');
	csrfTokens.set(token, Date.now() + 3600000); // 1 hour expiry
	return token;
}

function validateCSRFToken(token: string): boolean {
	const expiry = csrfTokens.get(token);
	if (!expiry || expiry < Date.now()) {
		csrfTokens.delete(token);
		return false;
	}
	return true;
}

// ===== 4. YOUR API (User OAuth Connection Endpoints) =====

const app = express();
app.use(express.json());

// Middleware to extract user from JWT/session
app.use((req: Request, res: Response, next: NextFunction) => {
	// Extract user from your auth system (JWT, session, etc.)
	const token = req.headers.authorization?.replace('Bearer ', '');
	if (token) {
		// Verify JWT and extract user ID
		// This is YOUR authentication - not ATP's
		req.userId = 'user123'; // Simplified for example
	}
	next();
});

// OAuth utilities - register the providers you need
const scopeChecker = new ScopeCheckerRegistry();
scopeChecker.register(new GitHubScopeChecker());
scopeChecker.register(new GoogleScopeChecker());
scopeChecker.register(new MicrosoftScopeChecker());
scopeChecker.register(new SlackScopeChecker());

// ===== ENDPOINT: Get CSRF Token =====
app.get('/api/csrf-token', (req: Request, res: Response) => {
	const token = generateCSRFToken();
	res.json({ csrfToken: token });
});

// CSRF validation middleware for state-changing operations
function csrfProtection(req: Request, res: Response, next: NextFunction) {
	const csrfToken = req.headers['x-csrf-token'] as string;

	if (!csrfToken || !validateCSRFToken(csrfToken)) {
		return res.status(403).json({ error: 'Invalid or missing CSRF token' });
	}

	next();
}

// ===== ENDPOINT: Connect OAuth Provider =====
app.post('/api/connect-provider', csrfProtection, async (req: Request, res: Response) => {
	try {
		const userId = req.userId;
		if (!userId) {
			return res.status(401).json({ error: 'Not authenticated' });
		}

		const { provider, accessToken, refreshToken } = req.body;

		// Input validation
		if (!provider || !accessToken) {
			return res.status(400).json({ error: 'provider and accessToken required' });
		}

		if (!validators.providerName(provider)) {
			return res.status(400).json({ error: 'Invalid provider name format' });
		}

		if (!validators.tokenFormat(accessToken, provider)) {
			return res.status(400).json({ error: 'Invalid token format for provider' });
		}

		if (refreshToken && typeof refreshToken !== 'string') {
			return res.status(400).json({ error: 'Invalid refresh token' });
		}

		// Check if ATP has a scope checker for this provider
		if (!scopeChecker.hasChecker(provider)) {
			return res.status(400).json({
				error: `Provider ${provider} not supported`,
				supportedProviders: ['github', 'google', 'microsoft', 'slack'],
			});
		}

		// ATP automatically checks scopes!
		console.log(`Checking scopes for ${provider}...`);

		try {
			const tokenInfo = await scopeChecker.getTokenInfo(provider, accessToken);

			if (!tokenInfo.valid) {
				return res.status(400).json({ error: 'Invalid or expired token' });
			}

			// Store using ATP's AuthProvider (in-memory for demo, use database in production)
			const authProvider = new InMemoryAuthProvider();
			await authProvider.setUserCredential(userId, provider, {
				token: accessToken,
				refreshToken,
				scopes: tokenInfo.scopes,
				expiresAt: tokenInfo.expiresAt,
			});

			res.json({
				success: true,
				provider,
				scopes: tokenInfo.scopes,
				message: `Successfully connected ${provider}`,
			});
		} catch (tokenError: any) {
			console.error('Token validation error:', tokenError.message);
			return res.status(400).json({
				error: 'Token validation failed',
				details: tokenError.message,
			});
		}
	} catch (error: any) {
		console.error('Error connecting provider:', error);
		res.status(500).json({ error: error.message });
	}
});

// ===== ENDPOINT: List Connected Providers =====
app.get('/api/connected-providers', async (req: Request, res: Response) => {
	try {
		const userId = req.userId;
		if (!userId) {
			return res.status(401).json({ error: 'Not authenticated' });
		}

		const authProvider = new InMemoryAuthProvider();
		const providers = await authProvider.listUserProviders(userId);

		// Get scopes for each provider
		const providerDetails = await Promise.all(
			providers.map(async (provider) => {
				const creds = await authProvider.getUserCredential(userId, provider);
				return {
					provider,
					scopes: creds?.scopes || [],
					connected: true,
				};
			})
		);

		res.json({
			providers: providerDetails,
		});
	} catch (error: any) {
		res.status(500).json({ error: error.message });
	}
});

// ===== ENDPOINT: Disconnect Provider =====
app.delete(
	'/api/disconnect-provider/:provider',
	csrfProtection,
	async (req: Request, res: Response) => {
		try {
			const userId = req.userId;
			if (!userId) {
				return res.status(401).json({ error: 'Not authenticated' });
			}

			const { provider } = req.params;

			if (!userId || !provider) {
				return res.status(400).json({ error: 'Missing userId or provider' });
			}

			// Validate provider name
			if (!validators.providerName(provider)) {
				return res.status(400).json({ error: 'Invalid provider name' });
			}

			const authProvider = new InMemoryAuthProvider();
			await authProvider.deleteUserCredential(userId, provider);

			res.json({
				success: true,
				message: `Disconnected ${provider}`,
			});
		} catch (error: any) {
			res.status(500).json({ error: error.message });
		}
	}
);

// ===== 5. ATP SERVER CONFIGURATION =====

// Create ATP server with user-scoped auth (in-memory for demo)
// In production: Replace with your database-backed AuthProvider
const authProvider = new InMemoryAuthProvider();

const atpServer = createServer({
	execution: {
		timeout: 30000,
	},
	discovery: {},
});

// Set the database auth provider (if supported by server version)
// atpServer.setAuthProvider(authProvider); // TODO: Uncomment when setAuthProvider is implemented

// Register GitHub API (scopes automatically extracted from OpenAPI)
atpServer.use({
	name: 'github',
	type: 'openapi',
	url: 'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json',
	auth: {
		scheme: 'bearer',
		// This tells ATP to use user's credential instead of server's env var
		source: 'user', // Indicates user-scoped auth
		oauthProvider: 'github', // Maps to authProvider.getUserCredential(userId, 'github')
	},
});

// Register Google Calendar API
atpServer.use({
	name: 'google-calendar',
	type: 'openapi',
	url: 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
	auth: {
		scheme: 'bearer',
		source: 'user',
		oauthProvider: 'google', // Maps to authProvider.getUserCredential(userId, 'google')
	},
});

// Mount ATP endpoints
app.use('/atp', atpServer.handler());

// ===== 5. START SERVER =====

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`
🚀 Server running on http://localhost:${PORT}

Endpoints:
  POST   /api/connect-provider        - Connect OAuth provider
  GET    /api/connected-providers     - List connected providers
  DELETE /api/disconnect-provider/:id - Disconnect provider
  
  POST   /atp/api/definitions         - Get ATP tool definitions (filtered by user)
  POST   /atp/api/execute             - Execute code with user's credentials

Note: Using in-memory storage (resets on restart)
      In production, replace InMemoryAuthProvider with database storage
	`);
});

// ===== 6. USAGE EXAMPLE =====

/**
 * CLIENT-SIDE FLOW:
 *
 * 1. User clicks "Connect GitHub"
 *    → Redirects to GitHub OAuth
 *    → User authorizes with specific scopes (e.g., read:repo)
 *    → GitHub redirects back with code
 *
 * 2. Your frontend exchanges code for token:
 *    fetch('https://github.com/login/oauth/access_token', {
 *      method: 'POST',
 *      body: JSON.stringify({
 *        code: authCode,
 *        client_id: YOUR_GITHUB_APP_ID,
 *        client_secret: YOUR_GITHUB_APP_SECRET,
 *      })
 *    })
 *
 * 3. Your frontend sends token to your backend:
 *    fetch('/api/connect-provider', {
 *      method: 'POST',
 *      headers: {
 *        'Authorization': 'Bearer YOUR_USER_JWT',
 *        'Content-Type': 'application/json'
 *      },
 *      body: JSON.stringify({
 *        provider: 'github',
 *        accessToken: 'gho_xxxxxxxxxxxx'
 *      })
 *    })
 *
 *    Response: {
 *      success: true,
 *      provider: 'github',
 *      scopes: ['read:repo', 'read:user'], // ATP checked these automatically!
 *    }
 *
 * 4. User calls ATP to get tools:
 *    fetch('/atp/api/definitions', {
 *      method: 'GET',
 *      headers: {
 *        'Authorization': 'Bearer YOUR_USER_JWT',
 *        'X-User-Id': 'user123'
 *      }
 *    })
 *
 *    Response: {
 *      typescript: '...',
 *      // Only includes GitHub tools user has access to:
 *      // - getRepository ✅ (requires read:repo)
 *      // - listIssues ✅ (requires read:repo)
 *      // - deleteRepository ❌ (requires delete_repo - user doesn't have it)
 *    }
 *
 * 5. User executes code:
 *    fetch('/atp/api/execute', {
 *      method: 'POST',
 *      body: JSON.stringify({
 *        code: 'const repo = await api.github.getRepository({ owner: "octocat", repo: "hello-world" })'
 *      })
 *    })
 *
 *    → ATP gets user123's GitHub token from database
 *    → Uses user's token to call GitHub API
 *    → Returns result
 */

/**
 * AUTOMATIC SCOPE FILTERING:
 *
 * When user has limited scopes, ATP automatically filters tools:
 *
 * User A: GitHub token with ['read:repo', 'write:repo']
 *   → Can see: getRepository, createIssue, updateIssue
 *   → Cannot see: deleteRepository, addCollaborator
 *
 * User B: GitHub token with ['read:repo'] only
 *   → Can see: getRepository, listIssues
 *   → Cannot see: createIssue, deleteRepository
 *
 * User C: No GitHub token
 *   → Cannot see any GitHub tools
 *   → GitHub API group not shown
 */
