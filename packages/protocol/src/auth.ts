/**
 * Authentication and credential management types for Agent Tool Protocol
 */

/**
 * Supported authentication schemes
 */
export type AuthScheme = 'apiKey' | 'bearer' | 'basic' | 'oauth2' | 'custom' | 'composite';

/**
 * Base authentication configuration
 */
export interface BaseAuthConfig {
	scheme: AuthScheme;
	/** Environment variable name to read credentials from */
	envVar?: string;
	/** Direct credential value (not recommended for production) */
	value?: string;
	/**
	 * Credential source: 'server' for server-level env vars (default), 'user' for user-scoped OAuth
	 */
	source?: 'server' | 'user';
	/**
	 * OAuth provider name for user-scoped credentials (e.g., 'github', 'google')
	 * Required when source='user'. Used to look up user's OAuth token from AuthProvider.
	 * Note: This is different from the 'provider' field which is for runtime credential providers.
	 */
	oauthProvider?: string;
	/** Runtime credential provider function name */
	provider?: string;
}

/**
 * API Key authentication (in header or query param)
 */
export interface APIKeyAuthConfig extends BaseAuthConfig {
	scheme: 'apiKey';
	/** Where to send the API key */
	in: 'header' | 'query';
	/** Parameter/header name */
	name: string;
}

/**
 * Bearer token authentication
 */
export interface BearerAuthConfig extends BaseAuthConfig {
	scheme: 'bearer';
	/** Optional bearer format (e.g., 'JWT') */
	bearerFormat?: string;
}

/**
 * HTTP Basic authentication
 */
export interface BasicAuthConfig extends BaseAuthConfig {
	scheme: 'basic';
	/** Username (can use envVar for dynamic value) */
	username?: string;
	/** Username environment variable */
	usernameEnvVar?: string;
	/** Password environment variable */
	passwordEnvVar?: string;
}

/**
 * OAuth2 authentication with automatic token refresh
 */
export interface OAuth2AuthConfig extends BaseAuthConfig {
	scheme: 'oauth2';
	/** OAuth2 flow type */
	flow: 'clientCredentials' | 'authorizationCode' | 'implicit' | 'password';
	/** Token endpoint URL */
	tokenUrl: string;
	/** Authorization endpoint (for authorizationCode/implicit) */
	authorizationUrl?: string;
	/** Client ID */
	clientId?: string;
	/** Client ID environment variable */
	clientIdEnvVar?: string;
	/** Client secret environment variable */
	clientSecretEnvVar?: string;
	/** Scopes required */
	scopes?: string[];
	/** Refresh token environment variable (for token refresh) */
	refreshTokenEnvVar?: string;
}

/**
 * Custom authentication with arbitrary headers
 */
export interface CustomAuthConfig extends BaseAuthConfig {
	scheme: 'custom';
	/** Custom headers to inject */
	headers: Record<string, string>;
	/** Environment variables to use for header values */
	headerEnvVars?: Record<string, string>;
	/** Query parameters to inject */
	queryParams?: Record<string, string>;
	/** Environment variables to use for query parameter values */
	queryParamEnvVars?: Record<string, string>;
}

/**
 * Composite authentication - combines multiple auth mechanisms
 * Useful for APIs that require multiple credentials (e.g., projectId + apiKey + secret)
 */
export interface CompositeAuthConfig extends BaseAuthConfig {
	scheme: 'composite';
	/**
	 * Multiple credentials to combine
	 * Example: { projectId: { envVar: 'PROJECT_ID' }, apiKey: { envVar: 'API_KEY' }, secret: { envVar: 'API_SECRET' } }
	 */
	credentials: Record<string, CredentialConfig>;
	/** How to inject credentials: 'header', 'query', or 'both' */
	injectAs?: 'header' | 'query' | 'both';
}

/**
 * Individual credential configuration for composite auth
 */
export interface CredentialConfig {
	/** Environment variable to read from */
	envVar?: string;
	/** Direct value (not recommended) */
	value?: string;
	/** Header name if injecting as header */
	headerName?: string;
	/** Query param name if injecting as query */
	queryParamName?: string;
	/** Whether this credential is required */
	required?: boolean;
}

/**
 * Union type of all auth configurations
 */
export type AuthConfig =
	| APIKeyAuthConfig
	| BearerAuthConfig
	| BasicAuthConfig
	| OAuth2AuthConfig
	| CustomAuthConfig
	| CompositeAuthConfig;

/**
 * Runtime credential provider
 * Allows dynamic credential resolution at runtime
 */
export interface CredentialProvider {
	name: string;
	/** Resolves credentials dynamically */
	resolve: () => Promise<Credentials> | Credentials;
}

/**
 * Resolved credentials ready to be injected into requests
 */
export interface Credentials {
	headers?: Record<string, string>;
	queryParams?: Record<string, string>;
}

/**
 * Credential resolver - resolves auth config to actual credentials
 */
export class CredentialResolver {
	private providers: Map<string, CredentialProvider> = new Map();

	/**
	 * Registers a runtime credential provider
	 */
	registerProvider(provider: CredentialProvider): void {
		this.providers.set(provider.name, provider);
	}

	/**
	 * Resolves auth configuration to credentials
	 */
	async resolve(authConfig: AuthConfig): Promise<Credentials> {
		if (authConfig.provider) {
			const provider = this.providers.get(authConfig.provider);
			if (!provider) {
				throw new Error(`Credential provider '${authConfig.provider}' not found`);
			}
			return await provider.resolve();
		}

		switch (authConfig.scheme) {
			case 'apiKey':
				return this.resolveAPIKey(authConfig);
			case 'bearer':
				return this.resolveBearer(authConfig);
			case 'basic':
				return this.resolveBasic(authConfig);
			case 'oauth2':
				return this.resolveOAuth2(authConfig);
			case 'custom':
				return this.resolveCustom(authConfig);
			case 'composite':
				return this.resolveComposite(authConfig);
			default:
				throw new Error(`Unsupported auth scheme: ${(authConfig as any).scheme}`);
		}
	}

	private resolveAPIKey(config: APIKeyAuthConfig): Credentials {
		const value = this.getValue(config);
		if (!value) {
			throw new Error(`API key not provided for '${config.name}'`);
		}

		if (config.in === 'header') {
			return { headers: { [config.name]: value } };
		} else {
			return { queryParams: { [config.name]: value } };
		}
	}

	private resolveBearer(config: BearerAuthConfig): Credentials {
		const token = this.getValue(config);
		if (!token) {
			throw new Error('Bearer token not provided');
		}

		return {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		};
	}

	private resolveBasic(config: BasicAuthConfig): Credentials {
		const username = config.usernameEnvVar ? process.env[config.usernameEnvVar] : config.username;
		const password = config.passwordEnvVar
			? process.env[config.passwordEnvVar]
			: this.getValue(config);

		if (!username || !password) {
			throw new Error('Basic auth username and password not provided');
		}

		const credentials = Buffer.from(`${username}:${password}`).toString('base64');
		return {
			headers: {
				Authorization: `Basic ${credentials}`,
			},
		};
	}

	private async resolveOAuth2(config: OAuth2AuthConfig): Promise<Credentials> {
		const clientId = config.clientIdEnvVar ? process.env[config.clientIdEnvVar] : config.clientId;
		const clientSecret = config.clientSecretEnvVar
			? process.env[config.clientSecretEnvVar]
			: undefined;

		if (!clientId || !clientSecret) {
			throw new Error('OAuth2 client credentials not provided');
		}

		if (config.flow === 'clientCredentials') {
			const token = await this.fetchOAuth2Token(
				config.tokenUrl,
				clientId,
				clientSecret,
				config.scopes
			);
			return {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			};
		}

		const token = this.getValue(config);
		if (token) {
			return {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			};
		}

		throw new Error(`OAuth2 flow '${config.flow}' requires manual token setup`);
	}

	private resolveCustom(config: CustomAuthConfig): Credentials {
		const headers: Record<string, string> = {};
		const queryParams: Record<string, string> = {};

		Object.assign(headers, config.headers);

		if (config.headerEnvVars) {
			for (const [headerName, envVar] of Object.entries(config.headerEnvVars)) {
				const value = process.env[envVar];
				if (value) {
					headers[headerName] = value;
				}
			}
		}

		if (config.queryParams) {
			Object.assign(queryParams, config.queryParams);
		}

		if (config.queryParamEnvVars) {
			for (const [paramName, envVar] of Object.entries(config.queryParamEnvVars)) {
				const value = process.env[envVar];
				if (value) {
					queryParams[paramName] = value;
				}
			}
		}

		return {
			headers: Object.keys(headers).length > 0 ? headers : undefined,
			queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
		};
	}

	private resolveComposite(config: CompositeAuthConfig): Credentials {
		const headers: Record<string, string> = {};
		const queryParams: Record<string, string> = {};

		for (const [credName, credConfig] of Object.entries(config.credentials)) {
			const value = credConfig.envVar ? process.env[credConfig.envVar] : credConfig.value;

			if (!value) {
				if (credConfig.required !== false) {
					throw new Error(`Required credential '${credName}' not provided`);
				}
				continue;
			}

			const injectAs = config.injectAs || 'header';

			if ((injectAs === 'header' || injectAs === 'both') && credConfig.headerName) {
				headers[credConfig.headerName] = value;
			}

			if ((injectAs === 'query' || injectAs === 'both') && credConfig.queryParamName) {
				queryParams[credConfig.queryParamName] = value;
			}

			if (!credConfig.headerName && !credConfig.queryParamName) {
				if (injectAs === 'query' || injectAs === 'both') {
					queryParams[credName] = value;
				} else {
					headers[`X-${credName}`] = value;
				}
			}
		}

		return {
			headers: Object.keys(headers).length > 0 ? headers : undefined,
			queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
		};
	}

	/**
	 * Gets credential value from config (env var or direct value)
	 */
	private getValue(config: BaseAuthConfig): string | undefined {
		if (config.envVar) {
			return process.env[config.envVar];
		}
		return config.value;
	}

	/**
	 * Fetches OAuth2 token using client credentials flow
	 */
	private async fetchOAuth2Token(
		tokenUrl: string,
		clientId: string,
		clientSecret: string,
		scopes?: string[]
	): Promise<string> {
		const params = new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: clientId,
			client_secret: clientSecret,
		});

		if (scopes && scopes.length > 0) {
			params.append('scope', scopes.join(' '));
		}

		const response = await fetch(tokenUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: params.toString(),
		});

		if (!response.ok) {
			throw new Error(`OAuth2 token fetch failed: ${response.statusText}`);
		}

		const data = (await response.json()) as { access_token: string };
		return data.access_token;
	}
}
