# OAuth Flow Example

This example demonstrates how to build a complete OAuth flow with user-scoped credentials for Agent Tool Protocol.

## Overview

This example shows:

1. **User OAuth Connection**: Users connect their GitHub, Google, etc. accounts
2. **Automatic Scope Checking**: ATP automatically checks what permissions each user has
3. **Database Storage**: User credentials stored in PostgreSQL
4. **Scope-Based Filtering**: Users only see tools they have permissions for
5. **User-Scoped Execution**: Code runs with each user's own credentials

## Architecture

```
┌─────────────┐
│   User UI   │
│             │
│ "Connect    │
│  GitHub"    │
└──────┬──────┘
       │
       │ 1. OAuth flow → GitHub
       │ 2. Get access token
       │
       ▼
┌─────────────────────┐
│  Your Backend API   │
│                     │
│  POST /api/connect  │◄─── 3. Send token
│         -provider   │
└──────────┬──────────┘
           │
           │ 4. ATP checks scopes
           │    (GitHub API call)
           ▼
    ┌──────────────┐
    │  ATP Scope   │
    │   Checker    │
    │              │
    │ • GitHub     │
    │ • Google     │
    │ • Microsoft  │
    └──────┬───────┘
           │
           │ 5. Store token + scopes
           ▼
    ┌──────────────┐
    │  PostgreSQL  │
    │   Database   │
    │              │
    │ user_id |... │
    │ user123 |... │
    └──────────────┘
           │
           │ 6. Later: ATP queries user's token
           │    when executing code
           ▼
    ┌──────────────┐
    │  ATP Server  │
    │              │
    │ Execute code │
    │ with user's  │
    │ credentials  │
    └──────────────┘
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Run the Server (No Database Required!)

```bash
npm run dev
```

Server will start on `http://localhost:3000`

**Note**: This example uses in-memory storage for simplicity. Data will be lost on restart. In production, implement your own `AuthProvider` that stores credentials in:

- PostgreSQL
- MongoDB
- Redis
- Any database of your choice

See the `InMemoryAuthProvider` class in `server.ts` for the interface you need to implement.

### 3. (Optional) Create OAuth Apps for Testing

To test with real OAuth providers:

1. Go to https://github.com/settings/developers
2. Create new OAuth App
3. Set callback URL: `http://localhost:3000/oauth/callback/github`
4. Save Client ID and Client Secret

```bash
export GITHUB_CLIENT_ID="your_client_id"
export GITHUB_CLIENT_SECRET="your_client_secret"
```

#### GitHub OAuth App

For testing with GitHub OAuth:

1. Go to https://console.cloud.google.com
2. Create OAuth 2.0 credentials
3. Set callback URL: `http://localhost:3000/oauth/callback/google`

```bash
export GOOGLE_CLIENT_ID="your_client_id"
export GOOGLE_CLIENT_SECRET="your_client_secret"
```

**Note**: The example works without real OAuth apps. The scope checking will fail gracefully for invalid tokens, but you can still see how the architecture works.

## API Endpoints

### Your Backend API (OAuth Management)

```bash
# Connect a provider
POST /api/connect-provider
Headers: Authorization: Bearer YOUR_USER_JWT
Body: {
  "provider": "github",
  "accessToken": "gho_xxxxxxxxxxxx",
  "refreshToken": "optional"
}

# List connected providers
GET /api/connected-providers
Headers: Authorization: Bearer YOUR_USER_JWT

# Disconnect a provider
DELETE /api/disconnect-provider/github
Headers: Authorization: Bearer YOUR_USER_JWT
```

### ATP Endpoints

```bash
# Get tool definitions (filtered by user's scopes)
GET /atp/api/definitions
Headers:
  Authorization: Bearer YOUR_USER_JWT
  X-User-Id: user123

# Execute code (using user's credentials)
POST /atp/api/execute
Headers:
  Authorization: Bearer YOUR_USER_JWT
  X-User-Id: user123
Body: {
  "code": "const repo = await api.github.getRepository({ owner: 'octocat', repo: 'hello-world' })"
}
```

## Complete Flow Example

### Step 1: User Connects GitHub

```javascript
// Frontend: Initiate OAuth
window.location.href = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=read:user,repo`;

// User authorizes → redirected back with code

// Frontend: Exchange code for token
const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
	body: JSON.stringify({
		code: authCode,
		client_id: GITHUB_CLIENT_ID,
		client_secret: GITHUB_CLIENT_SECRET,
	}),
});

const { access_token } = await tokenResponse.json();

// Frontend: Send to your backend
const connectResponse = await fetch('/api/connect-provider', {
	method: 'POST',
	headers: {
		Authorization: `Bearer ${userJWT}`,
		'Content-Type': 'application/json',
	},
	body: JSON.stringify({
		provider: 'github',
		accessToken: access_token,
	}),
});

// Response: { success: true, provider: 'github', scopes: ['read:user', 'repo'] }
```

### Step 2: ATP Automatically Checks Scopes

Behind the scenes, your backend does:

```typescript
// Your backend (handled by the example server)
const scopeChecker = new ScopeCheckerRegistry();
const tokenInfo = await scopeChecker.getTokenInfo('github', access_token);
// tokenInfo = { valid: true, scopes: ['read:user', 'repo'] }

// Store in database
await authProvider.setUserCredential(userId, 'github', {
	token: access_token,
	scopes: tokenInfo.scopes,
});
```

### Step 3: User Gets Filtered Tools

```javascript
// Frontend: Get available tools
const toolsResponse = await fetch('/atp/api/definitions', {
	headers: {
		Authorization: `Bearer ${userJWT}`,
		'X-User-Id': 'user123',
	},
});

const { typescript, tools } = await toolsResponse.json();
// Only shows tools user has scopes for!
// ✅ getRepository (requires: repo)
// ✅ listIssues (requires: repo)
// ❌ deleteRepository (requires: delete_repo - user doesn't have it!)
```

### Step 4: User Executes Code

```javascript
// Frontend: Execute code
const execResponse = await fetch('/atp/api/execute', {
	method: 'POST',
	headers: {
		Authorization: `Bearer ${userJWT}`,
		'Content-Type': 'application/json',
	},
	body: JSON.stringify({
		code: `
      const repo = await api.github.getRepository({
        owner: 'octocat',
        repo: 'hello-world'
      });
      return repo;
    `,
	}),
});

// ATP uses user's token to call GitHub API
// User's permissions are enforced by GitHub
```

## In-Memory Storage

This example uses a simple `Map` for storage to keep it simple and runnable without external dependencies:

```typescript
const inMemoryStorage = new Map<string, Map<string, UserCredentialData>>();

class InMemoryAuthProvider implements AuthProvider {
	// ... implements all AuthProvider methods
	// Stores credentials in Map instead of database
}
```

### Replacing with Real Database

To use in production, replace `InMemoryAuthProvider` with your own implementation:

#### PostgreSQL Example

```typescript
import { Pool } from 'pg';

class PostgresAuthProvider implements AuthProvider {
	constructor(private db: Pool) {}

	async getUserCredential(userId: string, provider: string) {
		const result = await this.db.query(
			'SELECT token, scopes, expires_at FROM user_credentials WHERE user_id = $1 AND provider = $2',
			[userId, provider]
		);
		return result.rows[0] || null;
	}

	async setUserCredential(userId: string, provider: string, data: UserCredentialData) {
		await this.db.query(
			`INSERT INTO user_credentials (user_id, provider, token, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, provider) DO UPDATE SET token = $3, scopes = $4`,
			[userId, provider, data.token, JSON.stringify(data.scopes), data.expiresAt]
		);
	}

	// ... implement other methods
}
```

**Database Schema:**

```sql
CREATE TABLE user_credentials (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  token TEXT NOT NULL,
  refresh_token TEXT,
  scopes JSONB,                    -- OAuth scopes as JSON array
  expires_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, provider)
);
```

## Scope Filtering Examples

### User A: Full GitHub Access

```json
{
	"userId": "user_a",
	"provider": "github",
	"scopes": ["repo", "delete_repo", "admin:org"]
}
```

**Can use:**

- ✅ getRepository
- ✅ createIssue
- ✅ deleteRepository
- ✅ addCollaborator

### User B: Read-Only GitHub Access

```json
{
	"userId": "user_b",
	"provider": "github",
	"scopes": ["read:user", "read:repo"]
}
```

**Can use:**

- ✅ getRepository
- ✅ listIssues
- ❌ createIssue (requires `repo`)
- ❌ deleteRepository (requires `delete_repo`)

### User C: No GitHub Connected

```json
{
	"userId": "user_c",
	"providers": ["google"]
}
```

**Can use:**

- ❌ No GitHub tools visible at all
- ✅ Google tools (if connected)

## Supported Providers

The example includes built-in scope checkers for:

- **GitHub**: `github`
- **Google**: `google`
- **Microsoft**: `microsoft`
- **Slack**: `slack`

### Adding Custom Providers

```typescript
import { ScopeChecker } from '@mondaydotcomorg/atp-protocol';

class CustomProviderScopeChecker implements ScopeChecker {
	provider = 'custom-api';

	async check(token: string): Promise<string[]> {
		// Call your provider's API to check scopes
		const response = await fetch('https://api.custom.com/tokeninfo', {
			headers: { Authorization: `Bearer ${token}` },
		});
		const data = await response.json();
		return data.scopes;
	}
}

// Register it
scopeChecker.register(new CustomProviderScopeChecker());
```

## Key Benefits

1. **Zero Manual Annotation**: Scopes extracted automatically from OpenAPI specs
2. **User Privacy**: Each user's own credentials, never shared
3. **Permission Enforcement**: Users can't access tools they don't have permissions for
4. **Automatic Caching**: Scope checks cached to avoid repeated API calls
5. **Built-in Providers**: GitHub, Google, Microsoft, Slack supported out of the box

## Security Notes

- User credentials are stored encrypted in the database (add encryption in production)
- Access tokens should be rotated regularly
- Implement refresh token logic for providers that support it
- Use HTTPS in production
- Implement rate limiting on OAuth endpoints
- Add CSRF protection for OAuth callbacks

## Next Steps

1. Add refresh token logic
2. Implement token encryption at rest
3. Add support for more OAuth providers
4. Implement scope upgrade flow (request more permissions)
5. Add audit logging for all OAuth operations

## License

MIT
