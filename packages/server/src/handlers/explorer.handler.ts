import type { RequestContext } from '../core/config.js';
import type { ExplorerService } from '../explorer/index.js';

export async function handleExplore(
	ctx: RequestContext,
	explorerService: ExplorerService
): Promise<unknown> {
	const body = ctx.body as { path?: string };
	const path = body.path || '/';

	const result = explorerService.explore(path);

	if (!result) {
		ctx.throw(404, `Path not found: ${path}`);
	}

	return result;
}
