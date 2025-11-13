import { BatchPauseExecutionError } from './errors.js';
import type { BatchCallInfo } from '../types.js';
import {
	nextSequenceNumber,
	getCachedResult,
	getCallSequenceNumber,
} from '@mondaydotcomorg/atp-runtime';

export async function batchParallel<T>(
	batchCalls: BatchCallInfo[],
	parallelId: string
): Promise<T[]> {
	const currentSequence = getCallSequenceNumber();
	const cachedResult = getCachedResult(currentSequence);
	if (cachedResult !== undefined) {
		nextSequenceNumber();
		return cachedResult as T[];
	}

	const sequenceForPause = nextSequenceNumber();
	throw new BatchPauseExecutionError(batchCalls, parallelId, sequenceForPause);
}
