import type { AuthProvider } from '@agent-tool-protocol/protocol';

/**
 * Environment variable based auth provider
 * Simple provider that reads credentials from process.env
 * Good for development and simple deployments
 */
export class EnvAuthProvider implements AuthProvider {
	name = 'env';
	private prefix: string;
	private credentials: Map<string, string>;

	constructor(
		options: {
			prefix?: string;
			credentials?: Record<string, string>;
		} = {}
	) {
		this.prefix = options.prefix || 'ATP_';
		this.credentials = new Map();

		if (options.credentials) {
			for (const [key, value] of Object.entries(options.credentials)) {
				this.credentials.set(key, value);
			}
		}
	}

	async getCredential(key: string): Promise<string | null> {
		if (this.credentials.has(key)) {
			return this.credentials.get(key) || null;
		}

		const envValue = process.env[key] || process.env[`${this.prefix}${key}`];
		return envValue || null;
	}

	async setCredential(key: string, value: string, _ttl?: number): Promise<void> {
		this.credentials.set(key, value);
	}

	async deleteCredential(key: string): Promise<void> {
		this.credentials.delete(key);
	}

	async listCredentials(): Promise<string[]> {
		const keys = new Set<string>();

		for (const key of this.credentials.keys()) {
			keys.add(key);
		}

		for (const key of Object.keys(process.env)) {
			if (key.startsWith(this.prefix)) {
				keys.add(key.substring(this.prefix.length));
			}
		}

		return Array.from(keys);
	}

	async disconnect(): Promise<void> {
		this.credentials.clear();
	}
}
