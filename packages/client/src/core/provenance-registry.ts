/**
 * Provenance Token Registry for Client
 *
 * Stores and manages provenance tokens for multi-step tracking
 */

export interface TokenEntry {
	token: string;
	addedAt: number;
}

export class ProvenanceTokenRegistry {
	private cache: Map<string, TokenEntry> = new Map();
	private maxSize: number;
	private ttl: number;

	constructor(maxSize: number = 10000, ttlHours: number = 1) {
		this.maxSize = maxSize;
		this.ttl = ttlHours * 3600 * 1000;
	}

	/**
	 * Add a token to the registry
	 */
	add(token: string): void {
		// Evict expired tokens first
		this.evictExpired();

		// Check if at capacity and evict LRU if needed
		if (this.cache.size >= this.maxSize) {
			this.evictLRU();
		}

		// Store token
		this.cache.set(token, {
			token,
			addedAt: Date.now(),
		});
	}

	/**
	 * Get recent tokens (non-expired, sorted by age, limited)
	 */
	getRecentTokens(maxCount: number = 1000): string[] {
		this.evictExpired();

		const now = Date.now();
		const expiredTokens: string[] = [];

		const entries = Array.from(this.cache.values())
			.filter((entry) => {
				try {
					const [body] = entry.token.split('.');
					if (!body) {
						expiredTokens.push(entry.token);
						return false;
					}
					const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
					if (!payload.expiresAt || payload.expiresAt <= now) {
						expiredTokens.push(entry.token);
						return false;
					}
					return true;
				} catch {
					expiredTokens.push(entry.token);
					return false;
				}
			})
			.sort((a, b) => b.addedAt - a.addedAt)
			.slice(0, maxCount);

		for (const token of expiredTokens) {
			this.cache.delete(token);
		}

		return entries.map((e) => e.token);
	}

	/**
	 * Clear all tokens
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Get registry size
	 */
	size(): number {
		return this.cache.size;
	}

	/**
	 * Evict expired tokens
	 */
	private evictExpired(): void {
		const now = Date.now();
		const toDelete: string[] = [];

		for (const [token, entry] of this.cache.entries()) {
			if (now - entry.addedAt > this.ttl) {
				toDelete.push(token);
			}
		}

		for (const token of toDelete) {
			this.cache.delete(token);
		}
	}

	/**
	 * Evict least recently used (oldest) token
	 */
	private evictLRU(): void {
		let oldestToken: string | null = null;
		let oldestTime = Infinity;

		for (const [token, entry] of this.cache.entries()) {
			if (entry.addedAt < oldestTime) {
				oldestTime = entry.addedAt;
				oldestToken = token;
			}
		}

		if (oldestToken) {
			this.cache.delete(oldestToken);
		}
	}
}
