import { pauseForCallback, CallbackType, EmbeddingOperation } from '../pause/index.js';
import { RuntimeAPI, RuntimeMethod } from '../metadata/decorators.js';
import { getVectorStore } from './vector-store.js';
import { cosineSimilarity, generateEmbeddingId } from './utils.js';
import { nextSequenceNumber, getCachedResult, shouldPauseForClient } from '../llm/replay.js';
import type { EmbeddingRecord, SearchOptions, SearchResult } from './types';

export type { EmbeddingOptions, EmbeddingRecord, SearchOptions, SearchResult } from './types';
export {
	VectorStore,
	initializeVectorStore,
	clearVectorStore,
	getVectorStore,
	setVectorStoreExecutionId,
	clearVectorStoreExecutionId,
} from './vector-store.js';
export { cosineSimilarity, generateEmbeddingId } from './utils.js';

/**
 * Embedding Runtime API
 *
 * Decorators automatically:
 * - Extract parameter names and types
 * - Generate metadata for type definitions
 * - Maintain single source of truth
 */
@RuntimeAPI('embedding', 'Embedding API - Client-side embedding with server-side vector storage')
class EmbeddingAPI {
	/**
	 * Request client to generate embedding and store it
	 * For batch inputs, returns array of IDs for stored embeddings
	 */
	@RuntimeMethod('Request client to generate and store embeddings', {
		input: {
			description: 'Text(s) to embed',
			type: 'string | string[]',
		},
		metadata: {
			description: 'Optional metadata to store with embeddings',
			optional: true,
			type: 'Record<string, unknown>',
		},
	})
	async embed(
		input: string | string[],
		metadata?: Record<string, unknown>
	): Promise<string | string[]> {
		const isBatch = Array.isArray(input);
		const texts = isBatch ? input : [input];
		const ids = texts.map((_, i) => generateEmbeddingId(i));

		const currentSequence = nextSequenceNumber();

		const cachedResult = getCachedResult(currentSequence);
		if (cachedResult !== undefined && cachedResult !== null) {
			const vectorStore = getVectorStore();
			const embedding = cachedResult as number[];
			for (let i = 0; i < texts.length; i++) {
				vectorStore.store(ids[i]!, texts[i]!, embedding, metadata);
			}
			return isBatch ? ids : ids[0]!;
		}

		if (shouldPauseForClient()) {
			pauseForCallback(CallbackType.EMBEDDING, EmbeddingOperation.EMBED, {
				text: isBatch ? texts.join('\n') : texts[0]!,
				input,
				ids,
				metadata,
				sequenceNumber: currentSequence,
			});
		}

		throw new Error('Embedding service not provided by client');
	}

	/**
	 * Search stored embeddings by similarity
	 * Query must be embedded first via embed()
	 */
	@RuntimeMethod('Search stored embeddings by similarity', {
		query: {
			description: 'Search query text (will be embedded by client)',
		},
		options: {
			description: 'Search options (topK, minSimilarity, filter)',
			optional: true,
			type: 'SearchOptions',
		},
	})
	async search(query: string, options?: Omit<SearchOptions, 'query'>): Promise<SearchResult[]> {
		const currentSequence = nextSequenceNumber();
		const vectorStore = getVectorStore();

		const cachedQueryEmbedding = getCachedResult(currentSequence);
		if (cachedQueryEmbedding !== undefined && cachedQueryEmbedding !== null) {
			vectorStore.setQueryEmbedding(cachedQueryEmbedding as number[]);

			const searchOptions: any = { ...options, query };
			if ((options as any)?.collection) {
				searchOptions.filter = {
					...searchOptions.filter,
					collection: (options as any).collection,
				};
			}

			return vectorStore.search(searchOptions);
		}

		if (shouldPauseForClient()) {
			pauseForCallback(CallbackType.EMBEDDING, EmbeddingOperation.SEARCH, {
				query,
				options: {
					...options,
					query,
				},
				sequenceNumber: currentSequence,
			});
		}

		throw new Error('Embedding service not provided by client');
	}

	/**
	 * Calculate cosine similarity between two embedding vectors
	 * This is a utility function that doesn't require client interaction
	 */
	@RuntimeMethod('Calculate cosine similarity between two embedding vectors', {
		embedding1: { description: 'First embedding vector', type: 'number[]' },
		embedding2: { description: 'Second embedding vector', type: 'number[]' },
	})
	similarity(embedding1: number[], embedding2: number[]): number {
		return cosineSimilarity(embedding1, embedding2);
	}

	/**
	 * Get all stored embeddings (useful for debugging)
	 */
	@RuntimeMethod('Get all stored embeddings')
	getAll(): EmbeddingRecord[] {
		return getVectorStore().getAll();
	}

	/**
	 * Get count of stored embeddings
	 */
	@RuntimeMethod('Get count of stored embeddings')
	count(): number {
		return getVectorStore().count();
	}
}

export const embedding = new EmbeddingAPI();
