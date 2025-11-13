import { log } from '@agent-tool-protocol/runtime';
import type { ExecutionConfig, CallbackType, CacheProvider } from '@mondaydotcomorg/atp-protocol';
import type { ProvenanceState, ProvenanceSnapshot } from '@mondaydotcomorg/atp-provenance';

/**
 * Callback request sent to client when execution is paused
 */
export interface CallbackRequest {
	type: CallbackType;
	operation: string;
	payload: Record<string, unknown>;
}

/**
 * Callback execution record for replay
 */
export interface CallbackRecord {
	type: CallbackType;
	operation: string;
	payload: Record<string, unknown>;
	result?: unknown;
	timestamp: number;
	sequenceNumber: number;
}

/**
 * Paused execution state
 */
export interface PausedExecution {
	executionId: string;
	code: string;
	config: ExecutionConfig;
	clientId: string;
	callbackRequest: CallbackRequest;
	pausedAt: number;

	callbackHistory: CallbackRecord[];
	currentCallbackIndex: number;

	context: {
		variables?: Record<string, unknown>;
		codeTransformed?: boolean;
	};

	provenanceState?: ProvenanceState | ProvenanceSnapshot;
}

/**
 * Execution state manager using CacheProvider
 * Works with any CacheProvider (MemoryCache, RedisCache, etc.)
 */
export class ExecutionStateManager {
	private cache: CacheProvider;
	private keyPrefix: string;
	private ttl: number;
	private maxPauseDuration: number;
	private metrics: {
		totalPauses: number;
		totalResumes: number;
		totalExpired: number;
		totalFailed: number;
	};

	constructor(
		cache: CacheProvider,
		options?: {
			keyPrefix?: string;
			ttl?: number;
			maxPauseDuration?: number;
		}
	) {
		this.cache = cache;
		this.keyPrefix = options?.keyPrefix || 'atp:execution:';
		this.ttl = options?.ttl || 3600;
		this.maxPauseDuration = (options?.maxPauseDuration ?? 3600) * 1000;
		this.metrics = {
			totalPauses: 0,
			totalResumes: 0,
			totalExpired: 0,
			totalFailed: 0,
		};

		log.info('ExecutionStateManager initialized', {
			cacheProvider: cache.name,
			ttl: this.ttl,
			maxPauseDuration: this.maxPauseDuration / 1000,
		});
	}

	/**
	 * Saves paused execution state
	 */
	async pause(state: PausedExecution): Promise<void> {
		this.metrics.totalPauses++;

		const key = this.getKey(state.executionId);
		const serialized = JSON.stringify(state);
		await this.cache.set(key, serialized, this.ttl);

		log.info('Execution paused', {
			executionId: state.executionId,
			clientId: state.clientId,
			callbackType: state.callbackRequest.type,
			cacheProvider: this.cache.name,
			ttl: this.ttl,
			maxPauseDuration: this.maxPauseDuration / 1000,
		});
	}

	/**
	 * Retrieves paused execution state
	 */
	async get(executionId: string): Promise<PausedExecution | null> {
		const key = this.getKey(executionId);
		const serialized = await this.cache.get(key);

		if (!serialized) {
			log.warn('Execution not found or expired', { executionId });
			this.metrics.totalExpired++;
			return null;
		}

		const state = JSON.parse(serialized as string) as PausedExecution;

		const pauseDuration = Date.now() - state.pausedAt;
		if (pauseDuration > this.maxPauseDuration) {
			log.warn('Execution pause duration exceeded maximum', {
				executionId,
				pauseDuration: pauseDuration / 1000,
				maxDuration: this.maxPauseDuration / 1000,
			});
			await this.delete(executionId);
			this.metrics.totalExpired++;
			return null;
		}

		await this.cache.set(key, serialized, this.ttl);

		this.metrics.totalResumes++;
		return state;
	}

	/**
	 * Deletes execution state
	 */
	async delete(executionId: string): Promise<void> {
		const key = this.getKey(executionId);
		await this.cache.delete(key);
		log.debug('Execution state deleted', { executionId });
	}

	/**
	 * Gets the full cache key for an execution ID
	 */
	private getKey(executionId: string): string {
		return `${this.keyPrefix}${executionId}`;
	}

	/**
	 * Closes connections and cleanup
	 */
	async close(): Promise<void> {
		if (this.cache.disconnect) {
			await this.cache.disconnect();
		}
		log.debug('ExecutionStateManager closed');
	}

	/**
	 * Gets storage type from cache provider
	 */
	getStorageType(): string {
		return this.cache.name;
	}

	/**
	 * Gets pause/resume metrics
	 */
	getMetrics() {
		return {
			...this.metrics,
			successRate:
				this.metrics.totalResumes > 0
					? ((this.metrics.totalResumes / (this.metrics.totalPauses || 1)) * 100).toFixed(2) + '%'
					: '0%',
			expiredRate:
				this.metrics.totalExpired > 0
					? ((this.metrics.totalExpired / (this.metrics.totalPauses || 1)) * 100).toFixed(2) + '%'
					: '0%',
		};
	}

	/**
	 * Resets metrics (useful for testing)
	 */
	resetMetrics(): void {
		this.metrics = {
			totalPauses: 0,
			totalResumes: 0,
			totalExpired: 0,
			totalFailed: 0,
		};
	}
}
