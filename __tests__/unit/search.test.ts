import { describe, test, expect } from '@jest/globals';
import { SearchEngine } from '@agent-tool-protocol/server';
import type { APIGroupConfig } from '@agent-tool-protocol/protocol';

describe('Search Engine', () => {
	const testApiGroups: APIGroupConfig[] = [
		{
			name: 'weather',
			type: 'custom',
			functions: [
				{
					name: 'getCurrentWeather',
					description: 'Get the current weather for a location',
					inputSchema: {
						type: 'object',
						properties: {
							location: { type: 'string' },
						},
						required: ['location'],
					},
					handler: async () => ({}),
				},
				{
					name: 'getForecast',
					description: 'Get weather forecast for the next 5 days',
					inputSchema: {
						type: 'object',
						properties: {
							location: { type: 'string' },
							days: { type: 'number' },
						},
						required: ['location'],
					},
					handler: async () => ({}),
				},
			],
		},
		{
			name: 'database',
			type: 'custom',
			functions: [
				{
					name: 'queryUsers',
					description: 'Query users from the database',
					inputSchema: {
						type: 'object',
						properties: {
							filter: { type: 'string' },
						},
					},
					handler: async () => ({}),
				},
			],
		},
	];

	test('should find functions by exact match', async () => {
		const searchEngine = new SearchEngine(testApiGroups);
		const results = await searchEngine.search({
			query: 'weather',
			maxResults: 10,
		});

		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.apiGroup).toBe('weather');
	});

	test('should rank results by relevance', async () => {
		const searchEngine = new SearchEngine(testApiGroups);
		const results = await searchEngine.search({
			query: 'current weather',
			maxResults: 10,
		});

		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.functionName).toBe('getCurrentWeather');
		expect(results[0]?.relevanceScore).toBeGreaterThan(0);
	});

	test('should filter by API group', async () => {
		const searchEngine = new SearchEngine(testApiGroups);
		const results = await searchEngine.search({
			query: 'get',
			apiGroups: ['weather'],
			maxResults: 10,
		});

		expect(results.length).toBeGreaterThan(0);
		results.forEach((result) => {
			expect(result.apiGroup).toBe('weather');
		});
	});

	test('should return empty array for no matches', async () => {
		const searchEngine = new SearchEngine(testApiGroups);
		const results = await searchEngine.search({
			query: 'nonexistent-function-xyz',
			maxResults: 10,
		});

		expect(results).toEqual([]);
	});

	test('should respect maxResults limit', async () => {
		const searchEngine = new SearchEngine(testApiGroups);
		const results = await searchEngine.search({
			query: 'get',
			maxResults: 1,
		});

		expect(results.length).toBeLessThanOrEqual(1);
	});

	test('should include function signature in results', async () => {
		const searchEngine = new SearchEngine(testApiGroups);
		const results = await searchEngine.search({
			query: 'weather',
			maxResults: 1,
		});

		expect(results[0]).toHaveProperty('signature');
		expect(results[0]?.signature).toContain('getCurrentWeather');
		expect(results[0]?.signature).toContain('location');
	});
});
