import type { RequestContext, ResolvedServerConfig } from '../core/config.js';
import type { SearchEngine } from '../search/index.js';

export async function handleSearch(
	ctx: RequestContext,
	searchEngine: SearchEngine,
	config: ResolvedServerConfig
): Promise<unknown> {
	const searchOptions = ctx.body as any;
	const results = await searchEngine.search(
		searchOptions,
		ctx.userId,
		ctx.auth,
		config.discovery.scopeFiltering
	);
	return { results };
}

export async function handleSearchQuery(
	ctx: RequestContext,
	searchEngine: SearchEngine,
	config: ResolvedServerConfig
): Promise<unknown> {
	const query = ctx.query.query || ctx.query.keyword || '';
	const results = await searchEngine.search(
		{ query },
		ctx.userId,
		ctx.auth,
		config.discovery.scopeFiltering
	);
	return { results };
}
