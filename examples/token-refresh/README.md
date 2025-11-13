# Token Refresh Example

This example demonstrates how to use the `preRequestHook` to automatically refresh short-lived authentication tokens.

## Use Case

Many authentication systems (OAuth2, OIDC, etc.) issue tokens with short time-to-live (TTL) values, such as:

- 3 minutes for bearer tokens
- 15 minutes for access tokens
- 1 hour for session tokens

The `preRequestHook` solves this by automatically refreshing tokens before each request.

## Running the Example

```bash
# Install dependencies
yarn install

# Run the example
tsx server.ts
```

## How It Works

1. **Token Manager**: Manages token lifecycle with caching
2. **Pre-Request Hook**: Intercepts every request to ensure fresh token
3. **Automatic Refresh**: Only refreshes when token is expired or about to expire

## Key Features

✅ **Automatic refresh** - No manual token management  
✅ **Efficient caching** - Only refreshes when needed (30-second buffer)  
✅ **Error handling** - Gracefully handles refresh failures  
✅ **Production-ready** - Thread-safe with proper expiry management

## See Also

- [Pre-Request Hook Documentation](../../docs/pre-request-hook.md)
- [Security Best Practices](../../docs/security.md)
