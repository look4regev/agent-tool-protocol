import { getCheckpointManager } from './checkpoint-manager.js';
import type { LoopCheckpoint } from '../types.js';

export async function resumablePromiseAll<T>(
	promises: Promise<T>[],
	parallelId: string
): Promise<T[]> {
	const checkpointManager = getCheckpointManager();
	const checkpoint = await checkpointManager.load(parallelId);
	const startIndex = checkpoint?.currentIndex || 0;
	const results = (checkpoint?.results as T[]) || [];

	for (let i = startIndex; i < promises.length; i++) {
		results[i] = (await promises[i]) as T;

		const newCheckpoint: LoopCheckpoint = {
			loopId: parallelId,
			currentIndex: i + 1,
			results: results,
			timestamp: Date.now(),
		};
		await checkpointManager.save(newCheckpoint);
	}

	await checkpointManager.clear(parallelId);
	return results;
}

export async function resumablePromiseAllSettled<T>(
	promises: Promise<T>[],
	parallelId: string
): Promise<PromiseSettledResult<T>[]> {
	const checkpointManager = getCheckpointManager();
	const checkpoint = await checkpointManager.load(parallelId);
	const startIndex = checkpoint?.currentIndex || 0;
	const results = (checkpoint?.results as PromiseSettledResult<T>[]) || [];

	for (let i = startIndex; i < promises.length; i++) {
		try {
			const value = (await promises[i]) as T;
			results[i] = { status: 'fulfilled', value };
		} catch (reason) {
			results[i] = { status: 'rejected', reason };
		}

		const newCheckpoint: LoopCheckpoint = {
			loopId: parallelId,
			currentIndex: i + 1,
			results: results,
			timestamp: Date.now(),
		};
		await checkpointManager.save(newCheckpoint);
	}

	await checkpointManager.clear(parallelId);
	return results;
}
