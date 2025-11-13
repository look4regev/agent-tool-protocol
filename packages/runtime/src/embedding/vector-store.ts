/**
 */
import type { EmbeddingRecord, SearchOptions, SearchResult } from './types.js';
import { cosineSimilarity } from './utils.js';

/**
 * In-memory vector store for the current execution
 * Cleared after each execution completes
 */
export class VectorStore {
	private records: Map<string, EmbeddingRecord> = new Map();
	private queryEmbedding: number[] | null = null;

	/**
	 * Store embeddings from client response
	 */
	store(id: string, text: string, embedding: number[], metadata?: Record<string, unknown>): void {
		this.records.set(id, { id, text, embedding, metadata });
	}

	/**
	 * Store multiple embeddings
	 */
	storeBatch(records: EmbeddingRecord[]): void {
		for (const record of records) {
			this.records.set(record.id, record);
		}
	}

	/**
	 * Set the query embedding for search
	 */
	setQueryEmbedding(embedding: number[]): void {
		this.queryEmbedding = embedding;
	}

	/**
	 * Search stored embeddings by similarity to query
	 */
	search(options: SearchOptions): SearchResult[] {
		if (!this.queryEmbedding) {
			throw new Error('No query embedding set. Call embed() with query first.');
		}

		const topK = options.topK ?? 5;
		const minSimilarity = options.minSimilarity ?? 0;

		const results: SearchResult[] = [];
		for (const record of this.records.values()) {
			if (options.filter && record.metadata) {
				let matches = true;
				for (const [key, value] of Object.entries(options.filter)) {
					if (record.metadata[key] !== value) {
						matches = false;
						break;
					}
				}
				if (!matches) continue;
			}

			const similarity = cosineSimilarity(this.queryEmbedding, record.embedding);
			if (similarity >= minSimilarity) {
				results.push({
					id: record.id,
					text: record.text,
					similarity,
					metadata: record.metadata,
				});
			}
		}

		results.sort((a, b) => b.similarity - a.similarity);
		return results.slice(0, topK);
	}

	/**
	 * Get all stored embeddings
	 */
	getAll(): EmbeddingRecord[] {
		return Array.from(this.records.values());
	}

	/**
	 * Get embedding by ID
	 */
	get(id: string): EmbeddingRecord | undefined {
		return this.records.get(id);
	}

	/**
	 * Clear all stored embeddings
	 */
	clear(): void {
		this.records.clear();
		this.queryEmbedding = null;
	}

	/**
	 * Get count of stored embeddings
	 */
	count(): number {
		return this.records.size;
	}
}

const vectorStores = new Map<string, VectorStore>();

let currentVectorStoreExecutionId: string | null = null;

/**
 * Set the current execution ID for vector store operations
 */
export function setVectorStoreExecutionId(executionId: string): void {
	currentVectorStoreExecutionId = executionId;
}

/**
 * Clear the current execution ID
 */
export function clearVectorStoreExecutionId(): void {
	currentVectorStoreExecutionId = null;
}

/**
 * Initialize a new vector store for a new execution
 */
export function initializeVectorStore(executionId?: string): void {
	const id = executionId || currentVectorStoreExecutionId;
	if (!id) {
		throw new Error('No execution ID set for vector store');
	}
	vectorStores.set(id, new VectorStore());
}

/**
 * Clear the vector store after execution completes
 */
export function clearVectorStore(executionId?: string): void {
	const id = executionId || currentVectorStoreExecutionId;
	if (!id) return;

	const store = vectorStores.get(id);
	if (store) {
		store.clear();
		vectorStores.delete(id);
	}
}

/**
 * Get the current vector store (for executor to manage)
 */
export function getVectorStore(executionId?: string): VectorStore {
	const id = executionId || currentVectorStoreExecutionId;
	if (!id) {
		throw new Error('No execution ID set for vector store');
	}

	let store = vectorStores.get(id);
	if (!store) {
		store = new VectorStore();
		vectorStores.set(id, store);
	}
	return store;
}
