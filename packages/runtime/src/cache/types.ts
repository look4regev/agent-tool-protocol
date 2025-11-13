export interface CacheConfig {
	type: 'memory' | 'redis';
	redis?: {
		host: string;
		port: number;
		password?: string;
		db?: number;
	};
	maxKeys?: number;
	defaultTTL?: number;
	checkPeriod?: number;
}

export interface CacheBackend {
	get<T>(key: string): Promise<T | null>;
	set(key: string, value: unknown, ttl?: number): Promise<void>;
	delete(key: string): Promise<void>;
	has(key: string): Promise<boolean>;
	clear(): Promise<void>;
}
