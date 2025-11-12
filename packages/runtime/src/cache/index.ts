/**
 * Cache API - Clean refactored version with decorators and extracted modules
 *
 * Benefits:
 * - No duplication between implementation and metadata
 * - Types auto-detected from TypeScript signatures
 * - Clean separation of concerns (backends, API)
 */
import { RuntimeAPI, RuntimeMethod } from '../metadata/decorators.js';
import { getCacheBackend } from './backends.js';

export type { CacheConfig, CacheBackend } from './types';
export { MemoryCacheBackend, RedisCacheBackend, initializeCache } from './backends.js';

/**
 * Cache Runtime API
 *
 * Store and retrieve data with optional TTL (Time To Live).
 * Supports in-memory (node-cache) and Redis backends.
 */
@RuntimeAPI('cache', 'Cache API - Store and retrieve data with optional TTL')
class CacheAPI {
	/**
	 * Gets a value from cache
	 */
	@RuntimeMethod('Get a value from cache by key', {
		key: { description: 'Cache key' },
	})
	async get<T>(key: string): Promise<T | null> {
		return getCacheBackend().get<T>(key);
	}

	/**
	 * Sets a value in cache with optional TTL in seconds
	 */
	@RuntimeMethod('Set a value in cache with optional TTL', {
		key: { description: 'Cache key' },
		value: { description: 'Value to cache', type: 'unknown' },
		ttl: { description: 'Time to live in seconds', optional: true },
	})
	async set(key: string, value: unknown, ttl?: number): Promise<void> {
		return getCacheBackend().set(key, value, ttl);
	}

	/**
	 * Deletes a value from cache
	 */
	@RuntimeMethod('Delete a value from cache', {
		key: { description: 'Cache key to delete' },
	})
	async delete(key: string): Promise<void> {
		return getCacheBackend().delete(key);
	}

	/**
	 * Checks if a key exists in cache
	 */
	@RuntimeMethod('Check if a key exists in cache', {
		key: { description: 'Cache key to check' },
	})
	async has(key: string): Promise<boolean> {
		return getCacheBackend().has(key);
	}

	/**
	 * Clears all cache entries
	 */
	@RuntimeMethod('Clear all cache entries')
	async clear(): Promise<void> {
		return getCacheBackend().clear();
	}
}

export const cache = new CacheAPI();
