import type { BatchCallInfo } from '../types.js';

export enum CheckpointOperation {
	SAVE = 'save',
	LOAD = 'load',
	CLEAR = 'clear',
}

export class BatchPauseExecutionError extends Error {
	public readonly calls: BatchCallInfo[];
	public readonly batchId: string;
	public readonly sequenceNumber: number;

	constructor(calls: BatchCallInfo[], batchId: string, sequenceNumber: number) {
		super(`Batch pause for parallel execution (${calls.length} callbacks)`);
		this.name = 'BatchPauseExecutionError';
		this.calls = calls;
		this.batchId = batchId;
		this.sequenceNumber = sequenceNumber;
	}
}

export class CheckpointError extends Error {
	public readonly checkpointId: string;
	public readonly operation: CheckpointOperation;

	constructor(message: string, checkpointId: string, operation: CheckpointOperation) {
		super(`Checkpoint ${operation} failed for ${checkpointId}: ${message}`);
		this.name = 'CheckpointError';
		this.checkpointId = checkpointId;
		this.operation = operation;
	}
}

export class TransformationError extends Error {
	public readonly code: string;
	public readonly pattern: string;
	public readonly location?: { line: number; column: number };

	constructor(
		message: string,
		code: string,
		pattern: string,
		location?: { line: number; column: number }
	) {
		const loc = location ? ` at line ${location.line}:${location.column}` : '';
		super(`Transformation failed for ${pattern}${loc}: ${message}`);
		this.name = 'TransformationError';
		this.code = code;
		this.pattern = pattern;
		this.location = location;
	}
}

export class InfiniteLoopDetectionError extends Error {
	public readonly loopId: string;
	public readonly iterationCount: number;

	constructor(loopId: string, iterationCount: number) {
		super(
			`Infinite loop detected: ${loopId} exceeded ${iterationCount} iterations without completing`
		);
		this.name = 'InfiniteLoopDetectionError';
		this.loopId = loopId;
		this.iterationCount = iterationCount;
	}
}

export function isBatchPauseError(error: unknown): error is BatchPauseExecutionError {
	return error instanceof BatchPauseExecutionError;
}

export function isCheckpointError(error: unknown): error is CheckpointError {
	return error instanceof CheckpointError;
}

export function isTransformationError(error: unknown): error is TransformationError {
	return error instanceof TransformationError;
}
