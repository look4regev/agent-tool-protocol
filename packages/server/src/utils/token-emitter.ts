import {
	issueProvenanceToken,
	type ProvenanceMetadata,
	type ProvenanceMode,
	ProvenanceMode as PM,
} from '@agent-tool-protocol/provenance';
import type { CacheProvider } from '@mondaydotcomorg/atp-protocol';
import type { log } from '@agent-tool-protocol/runtime';

type Logger = ReturnType<typeof log.child>;

interface TokenEmission {
	path: string;
	token: string;
}

/**
 * Emits provenance tokens for all values in the result that have provenance in the snapshot.
 * This works by:
 * 1. Traversing the actual serialized result object
 * 2. For each value, checking if it matches provenance in the snapshot
 * 3. Emitting tokens with the ACTUAL value for correct digest matching
 */
export async function emitProvenanceTokens(
	result: unknown,
	clientId: string,
	executionId: string,
	provenanceMode: ProvenanceMode,
	cacheProvider: CacheProvider,
	logger: Logger,
	maxTokens: number = 5000,
	tokenTTL: number = 3600,
	provenanceSnapshot?: {
		registry: Array<[string, ProvenanceMetadata]>;
		primitives: Array<[string, ProvenanceMetadata]>;
	}
): Promise<TokenEmission[]> {
	if (provenanceMode === PM.NONE || !result || !provenanceSnapshot) {
		logger.debug('Skipping token emission', {
			hasResult: !!result,
			hasSnapshot: !!provenanceSnapshot,
			mode: provenanceMode,
		});
		return [];
	}

	logger.info('Token emission starting from snapshot', {
		executionId,
		registrySize: provenanceSnapshot.registry.length,
		primitiveMapSize: provenanceSnapshot.primitives.length,
		resultType: typeof result,
	});

	const tokens: TokenEmission[] = [];
	const visited = new WeakSet<object>();
	const primitiveMap = new Map<string, ProvenanceMetadata>(provenanceSnapshot.primitives);

	const taintedValues = new Set<string>();
	for (const [key] of provenanceSnapshot.primitives) {
		if (key.startsWith('tainted:')) {
			taintedValues.add(key.slice('tainted:'.length));
		}
	}

	const queue: Array<{ value: unknown; path: string }> = [{ value: result, path: '' }];

	while (queue.length > 0 && tokens.length < maxTokens) {
		const { value, path } = queue.shift()!;

		if (value === null || value === undefined) {
			continue;
		}

		if (typeof value === 'string' || typeof value === 'number') {
			const valueStr = String(value);

			const taintedKey = `tainted:${valueStr}`;
			let meta = primitiveMap.get(taintedKey);

			if (!meta) {
				for (const [key, metadata] of primitiveMap.entries()) {
					if (!key.startsWith('tainted:')) {
						const parts = key.split(':');
						if (parts.length >= 3) {
							const derivedValue = parts.slice(2).join(':');
							if (derivedValue === valueStr) {
								meta = metadata;
								logger.debug('Found property-derived primitive match', {
									path,
									key,
									valuePreview: valueStr.substring(0, 30),
								});
								break;
							}
						}
					}
				}
			}

			if (meta) {
				try {
					const token = await issueProvenanceToken(
						meta,
						value,
						clientId,
						executionId,
						cacheProvider,
						tokenTTL
					);
					if (token) {
						tokens.push({ path, token });
						logger.debug('Emitted token for primitive', {
							path,
							valuePreview: typeof value === 'string' ? value.substring(0, 30) : value,
							tokenPrefix: token.substring(0, 10),
						});
					}
				} catch (error) {
					logger.warn('Failed to issue token for primitive', { path, error });
				}
			}
			continue;
		}

		if (typeof value === 'object') {
			if (visited.has(value as object)) {
				continue;
			}
			visited.add(value as object);

			// For objects, we need to check if ANY of the registry metadata applies
			// Since we can't match by identity, we emit tokens for ALL registry entries
			// and let the client match by digest
			if (provenanceSnapshot.registry.length > 0 && path === '') {
				for (const [id, meta] of provenanceSnapshot.registry) {
					if (tokens.length >= maxTokens) break;

					try {
						const token = await issueProvenanceToken(
							meta,
							value,
							clientId,
							executionId,
							cacheProvider,
							tokenTTL
						);
						if (token) {
							tokens.push({ path, token });
							logger.debug('Emitted token for object', {
								path,
								id,
								tokenPrefix: token.substring(0, 10),
							});
						}
					} catch (error) {
						logger.warn('Failed to issue token for object', { path, id, error });
					}
				}
			}

			if (Array.isArray(value)) {
				for (let i = 0; i < value.length; i++) {
					queue.push({ value: value[i], path: `${path}/${i}` });
				}
			} else {
				for (const key in value) {
					if (Object.prototype.hasOwnProperty.call(value, key)) {
						const escapedKey = key.replace(/~/g, '~0').replace(/\//g, '~1');
						queue.push({ value: (value as any)[key], path: `${path}/${escapedKey}` });
					}
				}
			}
		}
	}

	if (tokens.length >= maxTokens) {
		logger.warn('Max provenance tokens reached', { executionId, maxTokens });
	}

	logger.info('Token emission completed', { executionId, tokenCount: tokens.length });
	return tokens;
}
