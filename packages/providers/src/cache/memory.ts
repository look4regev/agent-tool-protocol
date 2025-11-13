import type { CacheProvider } from '@mondaydotcomorg/atp-protocol';

interface CacheEntry {
	value: unknown;
	expiresAt: number;
}

/**
 * In-memory cache provider with LRU eviction
 * Good for development and single-server deployments
 */
export class MemoryCache implements CacheProvider {
	name = 'memory';
	private cache: Map<string, CacheEntry>;
	private maxKeys: number;
	private defaultTTL: number;

	constructor(options: { maxKeys?: number; defaultTTL?: number } = {}) {
		this.cache = new Map();
		this.maxKeys = options.maxKeys || 1000;
		this.defaultTTL = options.defaultTTL || 3600;
	}

	async get<T>(key: string): Promise<T | null> {
		const entry = this.cache.get(key);

		if (!entry) {
			return null;
		}

		if (entry.expiresAt !== -1 && Date.now() > entry.expiresAt) {
			this.cache.delete(key);
			return null;
		}

		this.cache.delete(key);
		this.cache.set(key, entry);

		return entry.value as T;
	}

	async set(key: string, value: unknown, ttl?: number): Promise<void> {
		if (this.cache.size >= this.maxKeys && !this.cache.has(key)) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey) {
				this.cache.delete(firstKey);
			}
		}

		const expiresAt = ttl
			? Date.now() + ttl * 1000
			: this.defaultTTL > 0
				? Date.now() + this.defaultTTL * 1000
				: -1;

		this.cache.set(key, { value, expiresAt });
	}

	async delete(key: string): Promise<void> {
		this.cache.delete(key);
	}

	async has(key: string): Promise<boolean> {
		const value = await this.get(key);
		return value !== null;
	}

	async clear(pattern?: string): Promise<void> {
		if (!pattern) {
			this.cache.clear();
			return;
		}

		const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');

		for (const key of this.cache.keys()) {
			if (regex.test(key)) {
				this.cache.delete(key);
			}
		}
	}

	async mget(keys: string[]): Promise<Array<unknown | null>> {
		return Promise.all(keys.map((key) => this.get(key)));
	}

	async mset(entries: Array<[string, unknown, number?]>): Promise<void> {
		for (const [key, value, ttl] of entries) {
			await this.set(key, value, ttl);
		}
	}

	async disconnect(): Promise<void> {
		this.cache.clear();
	}

	/** Get cache statistics */
	getStats() {
		return {
			keys: this.cache.size,
			maxKeys: this.maxKeys,
			utilization: (this.cache.size / this.maxKeys) * 100,
		};
	}
}
