import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SearchOptions } from '@mondaydotcomorg/atp-protocol';
import type { SearchEngine } from '../search/index.js';
import { sendJson } from '../utils/response.js';

export async function handleSearch(
	req: IncomingMessage,
	res: ServerResponse,
	searchEngine: SearchEngine,
	body: string
): Promise<void> {
	const searchOptions = JSON.parse(body) as SearchOptions;
	const results = await searchEngine.search(searchOptions);

	sendJson(res, { results });
}
