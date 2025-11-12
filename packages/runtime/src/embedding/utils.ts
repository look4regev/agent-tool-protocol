/**

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vec1: number[], vec2: number[]): number {
	if (vec1.length !== vec2.length) {
		throw new Error(`Vectors must have the same length (${vec1.length} vs ${vec2.length})`);
	}

	let dotProduct = 0;
	let norm1 = 0;
	let norm2 = 0;

	for (let i = 0; i < vec1.length; i++) {
		dotProduct += vec1[i]! * vec2[i]!;
		norm1 += vec1[i]! * vec1[i]!;
		norm2 += vec2[i]! * vec2[i]!;
	}

	const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
	if (denominator === 0) {
		return 0;
	}

	return dotProduct / denominator;
}

/**
 * Generate a unique ID for an embedding
 */
export function generateEmbeddingId(index: number = 0): string {
	return `emb_${Date.now()}_${index}_${Math.random().toString(36).slice(2)}`;
}
