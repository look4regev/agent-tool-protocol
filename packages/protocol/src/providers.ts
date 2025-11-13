/**
 * Provider interfaces for dependency injection
 * These allow users to inject their own implementations for cache, auth, and audit
 */

/**
 * Cache provider interface
 * Allows pluggable caching backends (Memory, Redis, FileSystem, etc.)
 */
export interface CacheProvider {
	/** Provider name for identification */
	name: string;

	/** Get a value from cache */
	get<T>(key: string): Promise<T | null>;

	/** Set a value in cache with optional TTL (in seconds) */
	set(key: string, value: unknown, ttl?: number): Promise<void>;

	/** Delete a value from cache */
	delete(key: string): Promise<void>;

	/** Check if a key exists in cache */
	has(key: string): Promise<boolean>;

	/** Clear cache entries matching a pattern (e.g., 'user:*') */
	clear(pattern?: string): Promise<void>;

	/** Get multiple values at once (optional, for performance) */
	mget?(keys: string[]): Promise<Array<unknown | null>>;

	/** Set multiple values at once (optional, for performance) */
	mset?(entries: Array<[string, unknown, number?]>): Promise<void>;

	/** Disconnect/cleanup (optional) */
	disconnect?(): Promise<void>;
}

/**
 * User credential data stored per provider
 */
export interface UserCredentialData {
	/** Access token */
	token: string;

	/** OAuth scopes granted (if applicable) */
	scopes?: string[];

	/** Token expiration timestamp (milliseconds since epoch) */
	expiresAt?: number;

	/** Refresh token for automatic token refresh */
	refreshToken?: string;

	/** Additional provider-specific metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Auth provider interface
 * Allows pluggable credential storage (Env vars, AWS Secrets Manager, Vault, etc.)
 */
export interface AuthProvider {
	/** Provider name for identification */
	name: string;

	/** Get a credential by key (server-level credentials) */
	getCredential(key: string): Promise<string | null>;

	/** Set a credential (for OAuth tokens, etc.) */
	setCredential(key: string, value: string, ttl?: number): Promise<void>;

	/** Delete a credential */
	deleteCredential(key: string): Promise<void>;

	/** List all credential keys (optional, for admin/debugging) */
	listCredentials?(): Promise<string[]>;

	/**
	 * Get user-scoped credential for a specific provider
	 * @param userId - User identifier
	 * @param provider - Provider name (e.g., 'github', 'google', 'stripe')
	 * @returns User credential data or null if not found
	 */
	getUserCredential?(userId: string, provider: string): Promise<UserCredentialData | null>;

	/**
	 * Set user-scoped credential for a specific provider
	 * @param userId - User identifier
	 * @param provider - Provider name
	 * @param data - Credential data including token, scopes, etc.
	 */
	setUserCredential?(userId: string, provider: string, data: UserCredentialData): Promise<void>;

	/**
	 * Delete user's credential for a specific provider
	 * @param userId - User identifier
	 * @param provider - Provider name
	 */
	deleteUserCredential?(userId: string, provider: string): Promise<void>;

	/**
	 * List all providers a user has connected
	 * @param userId - User identifier
	 * @returns Array of provider names
	 */
	listUserProviders?(userId: string): Promise<string[]>;

	/** Disconnect/cleanup (optional) */
	disconnect?(): Promise<void>;
}

/**
 * Audit event structure
 * Comprehensive logging of all operations for security and compliance
 */
export interface AuditEvent {
	eventId: string;
	timestamp: number;

	clientId: string;
	userId?: string;
	ipAddress?: string;
	userAgent?: string;

	eventType: 'execution' | 'tool_call' | 'llm_call' | 'approval' | 'auth' | 'error' | 'client_init';
	action: string;
	resource?: string;
	resourceId?: string;

	code?: string;
	toolName?: string;
	apiGroup?: string;
	input?: unknown;
	output?: unknown;
	error?: {
		message: string;
		code?: string;
		stack?: string;
	};

	securityEvents?: string[];
	riskScore?: number;
	annotations?: Record<string, unknown>;

	duration?: number;
	memoryUsed?: number;
	llmCallsCount?: number;
	httpCallsCount?: number;

	status: 'success' | 'failed' | 'timeout' | 'cancelled' | 'paused';

	metadata?: Record<string, unknown>;
}

/**
 * Audit filter for querying events
 */
export interface AuditFilter {
	clientId?: string;
	userId?: string;
	eventType?: string | string[];
	from?: number;
	to?: number;
	resource?: string;
	status?: string | string[];
	minRiskScore?: number;
	limit?: number;
	offset?: number;
}

/**
 * Audit sink interface
 * Allows pluggable audit destinations (JSONL, PostgreSQL, Elasticsearch, S3, etc.)
 */
export interface AuditSink {
	/** Sink name for identification */
	name: string;

	/** Write a single audit event */
	write(event: AuditEvent): Promise<void>;

	/** Write multiple audit events (for performance) */
	writeBatch(events: AuditEvent[]): Promise<void>;

	/** Query audit events (optional, for queryable sinks) */
	query?(filter: AuditFilter): Promise<AuditEvent[]>;

	/** Disconnect/cleanup (optional) */
	disconnect?(): Promise<void>;
}

/**
 * Multi-sink audit wrapper
 * Allows writing to multiple audit sinks simultaneously
 */
export class MultiAuditSink implements AuditSink {
	name = 'multi';
	private sinks: AuditSink[];

	constructor(sinks: AuditSink[]) {
		this.sinks = sinks;
	}

	async write(event: AuditEvent): Promise<void> {
		await Promise.all(this.sinks.map((sink) => sink.write(event)));
	}

	async writeBatch(events: AuditEvent[]): Promise<void> {
		await Promise.all(this.sinks.map((sink) => sink.writeBatch(events)));
	}

	async query(filter: AuditFilter): Promise<AuditEvent[]> {
		for (const sink of this.sinks) {
			if (sink.query) {
				return await sink.query(filter);
			}
		}
		throw new Error('No queryable audit sink available');
	}

	async disconnect(): Promise<void> {
		await Promise.all(
			this.sinks.map((sink) => (sink.disconnect ? sink.disconnect() : Promise.resolve()))
		);
	}
}
