/**
 * OAuth and scope checking interfaces for Agent Tool Protocol
 */

/**
 * Scope checker interface
 * Checks what OAuth scopes a token has for a given provider
 */
export interface ScopeChecker {
	/** Provider name (e.g., 'github', 'google', 'microsoft') */
	provider: string;

	/**
	 * Check what scopes a token has
	 * @param token - Access token to check
	 * @returns Array of scope strings (e.g., ['repo', 'read:user'])
	 */
	check(token: string): Promise<string[]>;

	/**
	 * Validate if a token is still valid (optional)
	 * @param token - Access token to validate
	 * @returns true if valid, false if expired/revoked
	 */
	validate?(token: string): Promise<boolean>;
}

/**
 * Token information returned by providers
 */
export interface TokenInfo {
	/** Whether the token is valid */
	valid: boolean;

	/** OAuth scopes the token has */
	scopes: string[];

	/** Token expiration timestamp (milliseconds since epoch) */
	expiresAt?: number;

	/** User identifier from the provider */
	userId?: string;

	/** Additional provider-specific data */
	metadata?: Record<string, unknown>;
}

/**
 * Scope filtering configuration
 */
export interface ScopeFilteringConfig {
	/** Enable scope-based filtering */
	enabled: boolean;

	/**
	 * Filtering mode:
	 * - 'eager': Filter tools at /api/definitions based on user's scopes
	 * - 'lazy': Return all tools, validate scopes only at execution time
	 */
	mode: 'eager' | 'lazy';

	/**
	 * Cache TTL for scope checks in seconds
	 * Default: 3600 (1 hour)
	 */
	cacheTTL?: number;

	/**
	 * Fail behavior when scope checker not available for a provider
	 * - 'allow': Allow all tools (no filtering)
	 * - 'deny': Hide all tools requiring scopes
	 */
	fallback?: 'allow' | 'deny';
}
