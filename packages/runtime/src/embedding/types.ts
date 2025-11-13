/**
 * Embedding API Types
 */

export interface EmbeddingOptions {
	input: string | string[];
	model?: string;
	dimensions?: number;
	context?: Record<string, unknown>;
}

export interface EmbeddingRecord {
	id: string;
	text: string;
	embedding: number[];
	metadata?: Record<string, unknown>;
}

export interface SearchOptions {
	query: string;
	topK?: number;
	minSimilarity?: number;
	filter?: Record<string, unknown>;
}

export interface SearchResult {
	id: string;
	text: string;
	similarity: number;
	metadata?: Record<string, unknown>;
}
