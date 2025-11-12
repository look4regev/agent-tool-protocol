import { getCheckpointManager } from './checkpoint-manager.js';
import type { LoopCheckpoint } from '../types.js';
import { InfiniteLoopDetectionError } from './errors.js';

const MAX_ITERATIONS = 1000000;

export async function resumableMap<T, R>(
	items: T[],
	callback: (item: T, index: number, array: T[]) => Promise<R>,
	mapId: string
): Promise<R[]> {
	const checkpointManager = getCheckpointManager();
	const checkpoint = await checkpointManager.load(mapId);
	const startIndex = checkpoint?.currentIndex || 0;
	const results = (checkpoint?.results as R[]) || [];

	for (let i = startIndex; i < items.length; i++) {
		if (i > MAX_ITERATIONS) {
			throw new InfiniteLoopDetectionError(mapId, i);
		}

		results[i] = await callback(items[i]!, i, items);

		const newCheckpoint: LoopCheckpoint = {
			loopId: mapId,
			currentIndex: i + 1,
			results: results,
			timestamp: Date.now(),
		};
		await checkpointManager.save(newCheckpoint);
	}

	await checkpointManager.clear(mapId);
	return results;
}

export async function resumableForEach<T>(
	items: T[],
	callback: (item: T, index: number, array: T[]) => Promise<void>,
	forEachId: string
): Promise<void> {
	const checkpointManager = getCheckpointManager();
	const checkpoint = await checkpointManager.load(forEachId);
	const startIndex = checkpoint?.currentIndex || 0;

	for (let i = startIndex; i < items.length; i++) {
		if (i > MAX_ITERATIONS) {
			throw new InfiniteLoopDetectionError(forEachId, i);
		}

		await callback(items[i]!, i, items);

		const newCheckpoint: LoopCheckpoint = {
			loopId: forEachId,
			currentIndex: i + 1,
			timestamp: Date.now(),
		};
		await checkpointManager.save(newCheckpoint);
	}

	await checkpointManager.clear(forEachId);
}

export async function resumableFilter<T>(
	items: T[],
	callback: (item: T, index: number, array: T[]) => Promise<boolean>,
	filterId: string
): Promise<T[]> {
	const checkpointManager = getCheckpointManager();
	const checkpoint = await checkpointManager.load(filterId);
	const startIndex = checkpoint?.currentIndex || 0;
	const results = (checkpoint?.results as T[]) || [];

	for (let i = startIndex; i < items.length; i++) {
		if (i > MAX_ITERATIONS) {
			throw new InfiniteLoopDetectionError(filterId, i);
		}

		const passed = await callback(items[i]!, i, items);
		if (passed) {
			results.push(items[i]!);
		}

		const newCheckpoint: LoopCheckpoint = {
			loopId: filterId,
			currentIndex: i + 1,
			results: results,
			timestamp: Date.now(),
		};
		await checkpointManager.save(newCheckpoint);
	}

	await checkpointManager.clear(filterId);
	return results;
}

export async function resumableReduce<T, R>(
	items: T[],
	callback: (accumulator: R, item: T, index: number, array: T[]) => Promise<R>,
	initialValue: R,
	reduceId: string
): Promise<R> {
	const checkpointManager = getCheckpointManager();
	const checkpoint = await checkpointManager.load(reduceId);
	const startIndex = checkpoint?.currentIndex || 0;
	let accumulator = (checkpoint?.accumulator as R) ?? initialValue;

	for (let i = startIndex; i < items.length; i++) {
		if (i > MAX_ITERATIONS) {
			throw new InfiniteLoopDetectionError(reduceId, i);
		}

		accumulator = await callback(accumulator, items[i]!, i, items);

		const newCheckpoint: LoopCheckpoint = {
			loopId: reduceId,
			currentIndex: i + 1,
			accumulator: accumulator,
			timestamp: Date.now(),
		};
		await checkpointManager.save(newCheckpoint);
	}

	await checkpointManager.clear(reduceId);
	return accumulator;
}

export async function resumableFind<T>(
	items: T[],
	callback: (item: T, index: number, array: T[]) => Promise<boolean>,
	findId: string
): Promise<T | undefined> {
	const checkpointManager = getCheckpointManager();
	const checkpoint = await checkpointManager.load(findId);
	const startIndex = checkpoint?.currentIndex || 0;

	for (let i = startIndex; i < items.length; i++) {
		if (i > MAX_ITERATIONS) {
			throw new InfiniteLoopDetectionError(findId, i);
		}

		const found = await callback(items[i]!, i, items);
		if (found) {
			await checkpointManager.clear(findId);
			return items[i];
		}

		const newCheckpoint: LoopCheckpoint = {
			loopId: findId,
			currentIndex: i + 1,
			timestamp: Date.now(),
		};
		await checkpointManager.save(newCheckpoint);
	}

	await checkpointManager.clear(findId);
	return undefined;
}

export async function resumableSome<T>(
	items: T[],
	callback: (item: T, index: number, array: T[]) => Promise<boolean>,
	someId: string
): Promise<boolean> {
	const checkpointManager = getCheckpointManager();
	const checkpoint = await checkpointManager.load(someId);
	const startIndex = checkpoint?.currentIndex || 0;

	for (let i = startIndex; i < items.length; i++) {
		if (i > MAX_ITERATIONS) {
			throw new InfiniteLoopDetectionError(someId, i);
		}

		const result = await callback(items[i]!, i, items);
		if (result) {
			await checkpointManager.clear(someId);
			return true;
		}

		const newCheckpoint: LoopCheckpoint = {
			loopId: someId,
			currentIndex: i + 1,
			timestamp: Date.now(),
		};
		await checkpointManager.save(newCheckpoint);
	}

	await checkpointManager.clear(someId);
	return false;
}

export async function resumableEvery<T>(
	items: T[],
	callback: (item: T, index: number, array: T[]) => Promise<boolean>,
	everyId: string
): Promise<boolean> {
	const checkpointManager = getCheckpointManager();
	const checkpoint = await checkpointManager.load(everyId);
	const startIndex = checkpoint?.currentIndex || 0;

	for (let i = startIndex; i < items.length; i++) {
		if (i > MAX_ITERATIONS) {
			throw new InfiniteLoopDetectionError(everyId, i);
		}

		const result = await callback(items[i]!, i, items);
		if (!result) {
			await checkpointManager.clear(everyId);
			return false;
		}

		const newCheckpoint: LoopCheckpoint = {
			loopId: everyId,
			currentIndex: i + 1,
			timestamp: Date.now(),
		};
		await checkpointManager.save(newCheckpoint);
	}

	await checkpointManager.clear(everyId);
	return true;
}

export async function resumableFlatMap<T, R>(
	items: T[],
	callback: (item: T, index: number, array: T[]) => Promise<R[]>,
	flatMapId: string
): Promise<R[]> {
	const checkpointManager = getCheckpointManager();
	const checkpoint = await checkpointManager.load(flatMapId);
	const startIndex = checkpoint?.currentIndex || 0;
	const results = (checkpoint?.results as R[]) || [];

	for (let i = startIndex; i < items.length; i++) {
		if (i > MAX_ITERATIONS) {
			throw new InfiniteLoopDetectionError(flatMapId, i);
		}

		const mapped = await callback(items[i]!, i, items);
		results.push(...mapped);

		const newCheckpoint: LoopCheckpoint = {
			loopId: flatMapId,
			currentIndex: i + 1,
			results: results,
			timestamp: Date.now(),
		};
		await checkpointManager.save(newCheckpoint);
	}

	await checkpointManager.clear(flatMapId);
	return results;
}
