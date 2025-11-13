import type { CacheProvider, AuthProvider, AuditSink } from '@mondaydotcomorg/atp-protocol';

export interface BannerOptions {
	port: number;
	cacheProvider?: CacheProvider;
	authProvider?: AuthProvider;
	auditSink?: AuditSink;
}

/**
 * Prints a startup banner with server information
 */
export function printBanner(options: BannerOptions): void {
	const { port, cacheProvider, authProvider, auditSink } = options;

	console.log('\n✨ ATP Server ready!');
	console.log(`📍 http://localhost:${port}/`);
	console.log(`📚 Type definitions: http://localhost:${port}/openapi.json`);
	console.log(`🔍 API search: http://localhost:${port}/explorer`);

	if (cacheProvider) console.log(`💾 Cache: ${cacheProvider.name}`);
	if (authProvider) console.log(`🔒 Auth: ${authProvider.name}`);
	if (auditSink) console.log(`📝 Audit: ${auditSink.name}`);
	console.log();
}
