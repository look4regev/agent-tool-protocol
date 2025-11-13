/**
 * Production Example - Full production setup
 * Shows dependency injection, custom middleware, and security
 */

import { createServer, loadOpenAPI, MB, HOUR, MINUTE } from '@agent-tool-protocol/server';
import { MemoryCache, JSONLAuditSink } from '@mondaydotcomorg/atp-providers';
import type { Middleware } from '@agent-tool-protocol/server';

const server = createServer({
	execution: {
		timeout: 30000,
		memory: 256 * MB,
		llmCalls: 10,
	},
	clientInit: {
		tokenTTL: HOUR,
		tokenRotation: 30 * MINUTE,
	},
	discovery: {
		embeddings: false,
	},
	providers: {
		cache: new MemoryCache({ maxKeys: 1000, defaultTTL: 600 }),
		// auth defaults to EnvAuthProvider() - reads tokens from ATP_* env vars
		audit: new JSONLAuditSink({
			filePath: './audit.jsonl',
			sanitizeSecrets: true,
		}),
	},
	logger: 'info',
});

// Custom CORS middleware
const corsMiddleware: Middleware = async (ctx, next) => {
	const origin = ctx.headers['origin'];
	if (origin) {
		ctx.set('Access-Control-Allow-Origin', origin);
	} else {
		ctx.set('Access-Control-Allow-Origin', '*');
	}
	ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	ctx.set(
		'Access-Control-Allow-Headers',
		'Content-Type, Authorization, X-Client-ID, X-Client-Token'
	);
	ctx.set('Access-Control-Max-Age', '86400');

	if (ctx.method === 'OPTIONS') {
		ctx.status = 204;
		ctx.responseBody = null;
		return;
	}

	await next();
};

// Custom API key auth middleware
const API_KEYS = process.env.ATP_API_KEYS?.split(',') || [];
const apiKeyAuthMiddleware: Middleware = async (ctx, next) => {
	const apiKey = ctx.headers['x-api-key'];

	if (!apiKey) {
		// Optional for demo - allow requests without API key
		await next();
		return;
	}

	if (!API_KEYS.includes(apiKey)) {
		ctx.status = 403;
		ctx.responseBody = { error: 'Invalid API key' };
		return;
	}

	ctx.user = { apiKey };
	await next();
};

// Custom rate limiting middleware (simple in-memory implementation)
interface RateLimitEntry {
	count: number;
	resetTime: number;
}
const rateLimitStore = new Map<string, RateLimitEntry>();
const rateLimitMiddleware: Middleware = async (ctx, next) => {
	const key = `ratelimit:${ctx.headers['x-forwarded-for'] || 'anonymous'}:${ctx.path}`;
	const limit = ctx.path === '/api/execute' ? 50 : 100;
	const windowMs = 60 * 60 * 1000; // 1 hour

	const entry = rateLimitStore.get(key);
	if (entry && Date.now() < entry.resetTime) {
		if (entry.count >= limit) {
			ctx.status = 429;
			ctx.responseBody = {
				error: 'Rate limit exceeded',
				limit: `${limit}/hour`,
				retryAfter: Math.ceil((entry.resetTime - Date.now()) / 1000),
			};
			return;
		}
		entry.count++;
	} else {
		rateLimitStore.set(key, { count: 1, resetTime: Date.now() + windowMs });
	}

	await next();
};

// Apply middleware
server.use(corsMiddleware);
server.use(apiKeyAuthMiddleware);
server.use(rateLimitMiddleware);

// Load APIs
const petstore = await loadOpenAPI('./petstore-api.json', {
	name: 'petstore',
});

server.use(petstore);

// Add custom tools
server.tool('analyze', {
	description: 'Analyze data with AI',
	input: { data: 'string' },
	output: { summary: 'string', confidence: 'number' },
	handler: async (input: unknown) => {
		const { data } = input as { data: string };
		return {
			summary: `Analysis of: ${data.substring(0, 50)}...`,
			confidence: 0.95,
		};
	},
});

await server.listen(3000);
