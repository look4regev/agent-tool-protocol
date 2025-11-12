import type { Config } from 'jest';
import baseConfig from './jest.config.js';

/**
 * E2E test configuration - runs in band to avoid isolated-vm + Jest worker issues
 */
const config: Config = {
	...baseConfig,
	testMatch: ['**/__tests__/e2e/**/*.test.ts'],
	// Run tests serially to avoid isolated-vm crashes in Jest workers
	maxWorkers: 1,
	// Increase timeout for E2E tests
	testTimeout: 120000,
	// Disable worker threads
	workerThreads: false,
	// Disable code coverage for E2E tests
	collectCoverage: false,
	// Better error handling
	errorOnDeprecated: false,
	// Force exit for E2E tests - HTTP connection pools are hard to clean up
	// This is standard practice for integration tests
	forceExit: true,
	// Set NODE_OPTIONS for isolated-vm and Babel traverse compatibility
	testEnvironmentOptions: {
		NODE_OPTIONS: '--no-node-snapshot',
	},
};

export default config;
