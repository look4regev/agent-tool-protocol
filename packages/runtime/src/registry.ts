/**
 * Runtime API Registry
 *
 */
import type { RuntimeAPIMetadata } from './metadata/index.js';
import { GENERATED_METADATA } from './metadata/generated.js';

/**
 * Get all registered runtime APIs metadata
 *
 * This is generated at BUILD TIME by ts-morph, not at runtime
 */
export function getAllAPIs(): RuntimeAPIMetadata[] {
	return GENERATED_METADATA;
}

/**
 * Get metadata for a specific API by name
 */
export function getAPI(name: string): RuntimeAPIMetadata | undefined {
	return GENERATED_METADATA.find((api) => api.name === name);
}
