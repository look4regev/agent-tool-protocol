/**
 * Centralized E2E Test Configuration
 *
 * Change the model here to affect all E2E tests
 */

export const TEST_CONFIG = {
	// Ollama model to use for all E2E tests
	// Options:
	// - 'gpt-oss:20b' - Larger, more capable model (slower, better reasoning)
	// - 'qwen2.5-coder:7b' - Smaller, faster model (faster, basic reasoning)
	ollamaModel: 'qwen2.5-coder:7b',

	// LLM temperature for deterministic results
	temperature: 0,

	// Agent configuration
	maxIterations: 15,

	// Test timeouts (in milliseconds)
	setupTimeout: 60000,
	testTimeout: 120000,
};
