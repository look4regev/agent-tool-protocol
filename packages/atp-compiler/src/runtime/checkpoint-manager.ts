import type { CacheProvider } from '@mondaydotcomorg/atp-protocol';
import type { LoopCheckpoint } from '../types.js';
import { CheckpointError, CheckpointOperation } from './errors.js';

const MAX_CHECKPOINT_SIZE = 10 * 1024 * 1024;
const CHECKPOINT_TTL = 3600;

export class CheckpointManager {
	private cache: CacheProvider;
	private executionId: string;
	private prefix: string;

	constructor(executionId: string, cache: CacheProvider, prefix = 'checkpoint') {
		this.executionId = executionId;
		this.cache = cache;
		this.prefix = prefix;
	}

	async save(checkpoint: LoopCheckpoint): Promise<void> {
		const key = this.getKey(checkpoint.loopId);

		try {
			const serialized = JSON.stringify(checkpoint);

			if (serialized.length > MAX_CHECKPOINT_SIZE) {
				throw new CheckpointError(
					`Checkpoint size ${serialized.length} exceeds maximum ${MAX_CHECKPOINT_SIZE}`,
					checkpoint.loopId,
					CheckpointOperation.SAVE
				);
			}

			await this.cache.set(key, checkpoint, CHECKPOINT_TTL);
		} catch (error) {
			if (error instanceof CheckpointError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : String(error);
			throw new CheckpointError(message, checkpoint.loopId, CheckpointOperation.SAVE);
		}
	}

	async load(loopId: string): Promise<LoopCheckpoint | null> {
		const key = this.getKey(loopId);

		try {
			const checkpoint = await this.cache.get<LoopCheckpoint>(key);

			if (!checkpoint) {
				return null;
			}

			if (checkpoint.completed && checkpoint.completed instanceof Array) {
				checkpoint.completed = new Set(checkpoint.completed);
			}

			return checkpoint;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CheckpointError(message, loopId, CheckpointOperation.LOAD);
		}
	}

	async clear(loopId: string): Promise<void> {
		const key = this.getKey(loopId);

		try {
			await this.cache.delete(key);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CheckpointError(message, loopId, CheckpointOperation.CLEAR);
		}
	}

	async clearAll(): Promise<void> {}

	private getKey(loopId: string): string {
		return `${this.prefix}:${this.executionId}:${loopId}`;
	}

	getExecutionId(): string {
		return this.executionId;
	}
}

let globalCheckpointManager: CheckpointManager | null = null;

export function setCheckpointManager(manager: CheckpointManager): void {
	globalCheckpointManager = manager;
}

export function getCheckpointManager(): CheckpointManager {
	if (!globalCheckpointManager) {
		throw new Error('CheckpointManager not initialized');
	}
	return globalCheckpointManager;
}

export function clearCheckpointManager(): void {
	globalCheckpointManager = null;
}

export function hasCheckpointManager(): boolean {
	return globalCheckpointManager !== null;
}
