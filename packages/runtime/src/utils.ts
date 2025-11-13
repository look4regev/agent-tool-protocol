export interface RetryOptions {
	maxAttempts: number;
	delayMs: number;
}

export const utils = {
	async sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	},

	async retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
		let lastError: Error | undefined;
		for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
			try {
				return await fn();
			} catch (error) {
				lastError = error as Error;
				if (attempt < options.maxAttempts) {
					await this.sleep(options.delayMs);
				}
			}
		}
		throw lastError;
	},

	async parallel<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
		return Promise.all(tasks.map((task) => task()));
	},

	async sequence<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
		const results: T[] = [];
		for (const task of tasks) {
			results.push(await task());
		}
		return results;
	},
};
