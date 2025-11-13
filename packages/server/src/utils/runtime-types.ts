/**
 * Runtime SDK Type Generator
 *
 * Generates TypeScript definitions from the runtime API registry.
 */
import { GENERATED_METADATA, generateRuntimeTypes as generate } from '@mondaydotcomorg/atp-runtime';

/**
 * Generates TypeScript definitions for the runtime SDK
 * Delegates to the runtime package's own type generator
 */
export function generateRuntimeTypes(): string {
	return generate(GENERATED_METADATA);
}
