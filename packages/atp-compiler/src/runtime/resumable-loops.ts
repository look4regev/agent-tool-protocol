import { getCheckpointManager } from './checkpoint-manager.js';
import type { LoopCheckpoint } from '../types.js';
import { InfiniteLoopDetectionError } from './errors.js';

const MAX_ITERATIONS = 1000000;

export async function resumableForOf<T>(
	items: T[],
	callback: (item: T, index: number) => Promise<void>,
	loopId: string
): Promise<void> {
	const checkpointManager = getCheckpointManager();
	const checkpoint = await checkpointManager.load(loopId);
	const startIndex = checkpoint?.currentIndex || 0;

	for (let i = startIndex; i < items.length; i++) {
		if (i > MAX_ITERATIONS) {
			throw new InfiniteLoopDetectionError(loopId, i);
		}

		await callback(items[i]!, i);

		const newCheckpoint: LoopCheckpoint = {
			loopId,
			currentIndex: i + 1,
			timestamp: Date.now(),
		};
		await checkpointManager.save(newCheckpoint);
	}

	await checkpointManager.clear(loopId);
}

export async function resumableWhile(
	conditionFn: () => boolean | Promise<boolean>,
	bodyFn: (iteration: number) => Promise<void>,
	loopId: string
): Promise<void> {
	const checkpointManager = getCheckpointManager();
	const checkpoint = await checkpointManager.load(loopId);
	let iteration = checkpoint?.currentIndex || 0;

	while (await Promise.resolve(conditionFn())) {
		if (iteration > MAX_ITERATIONS) {
			throw new InfiniteLoopDetectionError(loopId, iteration);
		}

		await bodyFn(iteration);

		const newCheckpoint: LoopCheckpoint = {
			loopId,
			currentIndex: iteration + 1,
			timestamp: Date.now(),
		};
		await checkpointManager.save(newCheckpoint);

		iteration++;
	}

	await checkpointManager.clear(loopId);
}

export async function resumableForLoop(
	initValue: number,
	conditionFn: (i: number) => boolean,
	incrementFn: (i: number) => number,
	bodyFn: (i: number) => Promise<void>,
	loopId: string
): Promise<void> {
	const checkpointManager = getCheckpointManager();
	const checkpoint = await checkpointManager.load(loopId);
	let i = checkpoint?.currentIndex !== undefined ? checkpoint.currentIndex : initValue;

	let iterations = 0;
	while (conditionFn(i)) {
		if (iterations++ > MAX_ITERATIONS) {
			throw new InfiniteLoopDetectionError(loopId, iterations);
		}

		await bodyFn(i);

		const newCheckpoint: LoopCheckpoint = {
			loopId,
			currentIndex: incrementFn(i),
			timestamp: Date.now(),
		};
		await checkpointManager.save(newCheckpoint);

		i = incrementFn(i);
	}

	await checkpointManager.clear(loopId);
}
