/**
 * Provenance Re-attachment Utility
 *
 * Re-attaches provenance to values based on verified hints
 */
import {
	getProvenance,
	getProvenanceForPrimitive,
	createProvenanceProxy,
	markPrimitiveTainted,
	computeDigest,
	type ProvenanceMetadata,
} from '@agent-tool-protocol/provenance';

/**
 * Global registry of hint maps per execution
 * Key: executionId, Value: Map<digest, metadata>
 */
const executionHintMaps = new Map<string, Map<string, ProvenanceMetadata>>();

/**
 * Global registry of hint values per execution
 * Key: executionId, Value: Map<value, metadata> for substring checking
 */
const executionHintValues = new Map<string, Map<string, ProvenanceMetadata>>();

/**
 * Store hint map for an execution
 */
export function storeHintMap(executionId: string, hintMap: Map<string, ProvenanceMetadata>): void {
	executionHintMaps.set(executionId, hintMap);
}

/**
 * Store a hint value for substring matching
 */
export function storeHintValue(
	executionId: string,
	value: string,
	metadata: ProvenanceMetadata
): void {
	let valueMap = executionHintValues.get(executionId);
	if (!valueMap) {
		valueMap = new Map();
		executionHintValues.set(executionId, valueMap);
	}
	valueMap.set(value, metadata);
}

/**
 * Get hint map for an execution
 */
export function getHintMap(executionId: string): Map<string, ProvenanceMetadata> | undefined {
	return executionHintMaps.get(executionId);
}

/**
 * Get hint values for an execution (for substring matching)
 */
export function getHintValues(executionId: string): Map<string, ProvenanceMetadata> | undefined {
	return executionHintValues.get(executionId);
}

/**
 * Clear hint map for an execution (cleanup)
 */
export function clearHintMap(executionId: string): void {
	executionHintMaps.delete(executionId);
	executionHintValues.delete(executionId);
}

/**
 * Re-attach provenance from hints to tool arguments
 * Scans arguments recursively and attaches provenance based on value digests
 */
export function reattachProvenanceFromHints(
	args: Record<string, unknown>,
	hintMap: Map<string, ProvenanceMetadata>
): void {
	if (!hintMap || hintMap.size === 0) {
		return;
	}

	const visited = new WeakSet<object>();

	function processValue(value: unknown): void {
		if (value === null || value === undefined) {
			return;
		}

		// Handle primitives (string/number)
		if (typeof value === 'string' || typeof value === 'number') {
			// Skip if already has provenance
			if (getProvenanceForPrimitive(value)) {
				return;
			}

			// Compute digest and check hint map
			const digest = computeDigest(value);
			if (digest && hintMap.has(digest)) {
				const metadata = hintMap.get(digest)!;
				markPrimitiveTainted(value, metadata);
			}
			return;
		}

		// Handle objects/arrays
		if (typeof value === 'object') {
			// Prevent circular reference processing
			if (visited.has(value as object)) {
				return;
			}
			visited.add(value as object);

			// Skip if already has provenance
			if (getProvenance(value)) {
				return;
			}

			// Check if object itself has provenance in hints
			const digest = computeDigest(value);
			if (digest && hintMap.has(digest)) {
				const metadata = hintMap.get(digest)!;
				// Note: We can't modify the object in place, but we mark primitives inside
			}

			// Process children
			if (Array.isArray(value)) {
				for (const item of value) {
					processValue(item);
				}
			} else {
				for (const childValue of Object.values(value as Record<string, unknown>)) {
					processValue(childValue);
				}
			}
		}
	}

	// Process all argument values
	for (const value of Object.values(args)) {
		processValue(value);
	}
}
