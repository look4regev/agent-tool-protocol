import type { Logger } from '@agent-tool-protocol/runtime';
import type { CacheProvider } from '@agent-tool-protocol/protocol';
import {
	ATPCompiler,
	initializeRuntime as initializeCompilerRuntime,
	resumableForOf,
	resumableWhile,
	resumableForLoop,
	resumableMap,
	resumableForEach,
	resumableFilter,
	resumableReduce,
	resumableFind,
	resumableSome,
	resumableEvery,
	resumableFlatMap,
	resumablePromiseAll,
	resumablePromiseAllSettled,
	batchParallel,
} from '@mondaydotcomorg/atp-compiler';
import { ATP_COMPILER_ENABLED, ATP_BATCH_SIZE_THRESHOLD } from './constants.js';

const transformCache = new Map<string, string>();

function getCodeHash(code: string): string {
	let hash = 0;
	for (let i = 0; i < code.length; i++) {
		const char = code.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return hash.toString(36);
}

export interface CompilerResult {
	code: string;
	useCompiler: boolean;
	metadata?: {
		patterns?: string[];
		batchable?: boolean;
		loopCount?: number;
		arrayMethodCount?: number;
		parallelCallCount?: number;
	};
}

export function getCompilerRuntime() {
	return {
		resumableForOf,
		resumableWhile,
		resumableForLoop,
		resumableMap,
		resumableForEach,
		resumableFilter,
		resumableReduce,
		resumableFind,
		resumableSome,
		resumableEvery,
		resumableFlatMap,
		resumablePromiseAll,
		resumablePromiseAllSettled,
		batchParallel,
	};
}

export async function transformCodeWithCompiler(
	code: string,
	executionId: string,
	cacheProvider: CacheProvider,
	executionLogger: Logger
): Promise<CompilerResult> {
	if (!ATP_COMPILER_ENABLED) {
		return { code, useCompiler: false };
	}

	try {
		const compiler = new ATPCompiler({
			enableBatchParallel: true,
			batchSizeThreshold: ATP_BATCH_SIZE_THRESHOLD,
		});
		const detection = compiler.detect(code);

		executionLogger.info('ATP Compiler detection result', {
			needsTransform: detection.needsTransform,
			patterns: detection.patterns,
			batchable: detection.batchableParallel,
		});

		if (detection.needsTransform) {
			const codeHash = getCodeHash(code);
			const cached = transformCache.get(codeHash);
			if (cached) {
				executionLogger.debug('Using cached transformed code', { codeHash });
				initializeCompilerRuntime({
					executionId,
					cache: cacheProvider,
				});
				return {
					code: cached,
					useCompiler: true,
					metadata: {
						patterns: detection.patterns,
						batchable: detection.batchableParallel,
					},
				};
			}

			initializeCompilerRuntime({
				executionId,
				cache: cacheProvider,
			});

			const transformed = compiler.transform(code);

			transformCache.set(codeHash, transformed.code);

			executionLogger.info('Code transformed by ATP compiler', {
				patterns: detection.patterns,
				batchable: detection.batchableParallel,
				loopCount: transformed.metadata.loopCount,
				arrayMethodCount: transformed.metadata.arrayMethodCount,
				parallelCallCount: transformed.metadata.parallelCallCount,
				batchSizeThreshold: ATP_BATCH_SIZE_THRESHOLD,
			});

			return {
				code: transformed.code,
				useCompiler: true,
				metadata: {
					patterns: detection.patterns,
					batchable: detection.batchableParallel,
					loopCount: transformed.metadata.loopCount,
					arrayMethodCount: transformed.metadata.arrayMethodCount,
					parallelCallCount: transformed.metadata.parallelCallCount,
				},
			};
		}
	} catch (error) {
		executionLogger.error('ATP compiler transformation failed, falling back', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
	}

	return { code, useCompiler: false };
}
