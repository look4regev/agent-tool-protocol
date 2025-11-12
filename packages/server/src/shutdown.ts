import { log } from '@agent-tool-protocol/runtime';
import type { Server } from 'node:http';
import { flushAuditQueue, shutdownAudit } from './middleware/audit.js';
import type { ExecutionStateManager } from './execution-state/index.js';
import type { ClientCallbackManager } from './callback/index.js';

interface ShutdownHandlers {
	server?: Server;
	stateManager?: ExecutionStateManager;
	callbackManager?: ClientCallbackManager;
	customHandlers?: Array<() => Promise<void>>;
}

let isShuttingDown = false;
let shutdownHandlers: ShutdownHandlers = {};

/**
 * Registers handlers for graceful shutdown
 */
export function registerShutdownHandlers(handlers: ShutdownHandlers): void {
	shutdownHandlers = handlers;

	process.on('SIGTERM', handleShutdown);
	process.on('SIGINT', handleShutdown);

	process.on('uncaughtException', (error) => {
		log.error('Uncaught exception', { error: error.message, stack: error.stack });
		handleShutdown();
	});

	process.on('unhandledRejection', (reason) => {
		log.error('Unhandled promise rejection', { reason });
		handleShutdown();
	});
}

/**
 * Performs graceful shutdown
 */
async function handleShutdown(): Promise<void> {
	if (isShuttingDown) {
		log.warn('Shutdown already in progress');
		return;
	}

	isShuttingDown = true;
	log.info('Starting graceful shutdown...');

	const shutdownTimeout = setTimeout(() => {
		log.error('Shutdown timeout exceeded, forcing exit');
		process.exit(1);
	}, 30000);

	try {
		if (shutdownHandlers.server) {
			log.info('Closing HTTP server...');
			await new Promise<void>((resolve, reject) => {
				shutdownHandlers.server!.close((err) => {
					if (err) reject(err);
					else resolve();
				});
			});
			log.info('HTTP server closed');
		}

		log.info('Flushing audit queue...');
		await flushAuditQueue();
		shutdownAudit();
		log.info('Audit system stopped');

		if (shutdownHandlers.stateManager) {
			log.info('Closing state manager...');
			await shutdownHandlers.stateManager.close();
			log.info('State manager closed');
		}

		if (shutdownHandlers.callbackManager) {
			log.info('Cleaning up callback manager...');
			shutdownHandlers.callbackManager.destroy();
			log.info('Callback manager cleaned up');
		}

		if (shutdownHandlers.customHandlers) {
			log.info('Running custom shutdown handlers...');
			for (const handler of shutdownHandlers.customHandlers) {
				await handler();
			}
			log.info('Custom handlers completed');
		}

		clearTimeout(shutdownTimeout);
		log.info('Graceful shutdown completed');
		process.exit(0);
	} catch (error) {
		clearTimeout(shutdownTimeout);
		log.error('Error during shutdown', {
			error: error instanceof Error ? error.message : 'Unknown error',
		});
		process.exit(1);
	}
}

/**
 * Triggers graceful shutdown programmatically
 */
export function shutdown(): void {
	handleShutdown();
}
