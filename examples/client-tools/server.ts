import { createServer } from '@mondaydotcomorg/atp-server';

/**
 * Basic ATP server for client tools example
 * No server-side tools needed - client will provide its own tools
 */

const server = createServer({
	execution: {
		timeout: 30000,
		memory: 128 * 1024 * 1024, // 128 MB
		llmCalls: 10,
	},
	logger: 'info',
});

async function main() {
	await server.listen(3333);
	console.log('🚀 ATP Server running on http://localhost:3333');
	console.log('📦 Client tools example - waiting for client connections...');
}

main().catch((error) => {
	console.error('Server error:', error);
	process.exit(1);
});
