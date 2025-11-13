# Production Example

Complete production setup with:

- Dependency injection (cache, auth, audit)
- Security middleware (CORS, rate limiting, API keys)
- Client session management
- OpenAPI loading
- Custom tools

## Setup

```bash
# Set API keys (optional)
export ATP_API_KEYS="key1,key2,key3"

# Run
tsx server.ts
```

## Features

### Provider Injection

- **Cache**: MemoryCache (use RedisCache in production)
- **Auth**: EnvAuthProvider (use AWSSecretsAuthProvider in production)
- **Audit**: JSONLAuditSink (use PostgresAuditSink in production)

### Middleware

- **CORS**: Allow all origins
- **Rate Limiting**: 100/hour global, 50/hour for execute
- **API Key Auth**: Optional authentication

### Client Sessions

- Enabled with 1h TTL
- Token rotation every 30min
- Requires cache provider

## Test

```bash
# Initialize client
curl -X POST http://localhost:3000/api/init \
  -H "Content-Type: application/json" \
  -d '{"clientInfo": {"name": "my-app", "version": "1.0.0"}}'

# Get definitions
curl http://localhost:3000/api/definitions

# View audit log
cat audit.jsonl
```

## Production Deployment

Replace providers with production-grade alternatives:

```typescript
import {
	RedisCache,
	PostgresAuditSink,
	AWSSecretsAuthProvider,
} from '@mondaydotcomorg/atp-providers';

server.setCache(new RedisCache({ url: process.env.REDIS_URL }));
server.setAudit(new PostgresAuditSink({ connectionString: process.env.DATABASE_URL }));
server.setAuthProvider(new AWSSecretsAuthProvider({ region: 'us-east-1' }));
```
