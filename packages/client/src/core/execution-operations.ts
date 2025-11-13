import type { ExecutionResult, ExecutionConfig } from '@mondaydotcomorg/atp-protocol';
import { ExecutionStatus } from '@mondaydotcomorg/atp-protocol';
import type { ClientSession } from './session.js';
import type { ServiceProviders } from './service-providers';
import { ClientCallbackError } from '../errors.js';
import { ProvenanceTokenRegistry } from './provenance-registry.js';

export class ExecutionOperations {
	private session: ClientSession;
	private serviceProviders: ServiceProviders;
	private tokenRegistry: ProvenanceTokenRegistry;

	constructor(session: ClientSession, serviceProviders: ServiceProviders) {
		this.session = session;
		this.serviceProviders = serviceProviders;
		this.tokenRegistry = new ProvenanceTokenRegistry();
	}

	/**
	 * Executes code on the server with real-time progress updates via SSE.
	 */
	async executeStream(
		code: string,
		config?: Partial<ExecutionConfig>,
		onProgress?: (message: string, fraction: number) => void
	): Promise<ExecutionResult> {
		await this.session.ensureInitialized();

		const url = `${this.session.getBaseUrl()}/api/execute/stream`;
		const body = JSON.stringify({ code, config });
		const headers = await this.session.prepareHeaders('POST', url, body);

		return new Promise((resolve, reject) => {
			const fetchImpl = typeof fetch !== 'undefined' ? fetch : require('undici').fetch;

			fetchImpl(url, {
				method: 'POST',
				headers,
				body,
			})
				.then(async (response: Response) => {
					if (!response.ok) {
						throw new Error(`HTTP ${response.status}: ${response.statusText}`);
					}

					const reader = response.body?.getReader();
					if (!reader) {
						throw new Error('Response body is not readable');
					}

					const decoder = new TextDecoder();
					let buffer = '';
					let result: ExecutionResult | null = null;

					while (true) {
						const { done, value } = await reader.read();

						if (done) break;

						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split('\n');
						buffer = lines.pop() || '';

						for (let i = 0; i < lines.length; i++) {
							const line = lines[i];

							if (line && line.startsWith('event:')) {
								const event = line.substring(6).trim();

								for (let j = i + 1; j < lines.length; j++) {
									const dataLine = lines[j];
									if (dataLine && dataLine.startsWith('data:')) {
										const dataStr = dataLine.substring(5).trim();
										if (dataStr) {
											try {
												const data = JSON.parse(dataStr);

												if (event === 'progress' && onProgress) {
													onProgress(data.message, data.fraction);
												} else if (event === 'result') {
													result = data as ExecutionResult;
												} else if (event === 'error') {
													reject(new Error(data.message));
													return;
												}
											} catch (e) {
												console.error('Failed to parse SSE data:', dataStr);
											}
										}
										break;
									}
								}
							}
						}
					}

					if (result) {
						resolve(result);
					} else {
						reject(new Error('No result received from server'));
					}
				})
				.catch(reject);
		});
	}

	/**
	 * Executes code on the server in a sandboxed environment.
	 */
	async execute(code: string, config?: Partial<ExecutionConfig>): Promise<ExecutionResult> {
		await this.session.ensureInitialized();

		const hints = this.tokenRegistry.getRecentTokens(1000);

		const executionConfig = {
			...config,
			clientServices: {
				hasLLM: !!this.serviceProviders.getLLM(),
				hasApproval: !!this.serviceProviders.getApproval(),
				hasEmbedding: !!this.serviceProviders.getEmbedding(),
				hasTools: this.serviceProviders.hasTools(),
			},
			provenanceHints: hints.length > 0 ? hints : undefined,
		};

		const url = `${this.session.getBaseUrl()}/api/execute`;
		const body = JSON.stringify({ code, config: executionConfig });
		const headers = await this.session.prepareHeaders('POST', url, body);

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body,
		});

		this.session.updateToken(response);

		if (!response.ok) {
			const error = (await response.json()) as { error: string };
			throw new Error(`Execution failed: ${error.error || response.statusText}`);
		}

		const result = (await response.json()) as ExecutionResult;

		if (result.provenanceTokens && result.provenanceTokens.length > 0) {
			for (const { token } of result.provenanceTokens) {
				this.tokenRegistry.add(token);
			}
		}

		if (result.status === ExecutionStatus.PAUSED && result.needsCallbacks) {
			return await this.handleBatchCallbacksAndResume(result);
		}

		if (result.status === ExecutionStatus.PAUSED && result.needsCallback) {
			return await this.handlePauseAndResume(result);
		}

		return result;
	}

	/**
	 * Handles batch callbacks by executing them in parallel and resuming.
	 */
	private async handleBatchCallbacksAndResume(
		pausedResult: ExecutionResult
	): Promise<ExecutionResult> {
		if (!pausedResult.needsCallbacks || pausedResult.needsCallbacks.length === 0) {
			throw new Error('No batch callback requests in paused execution');
		}

		const batchResults = await Promise.all(
			pausedResult.needsCallbacks.map(async (cb) => {
				const callbackResult = await this.serviceProviders.handleCallback(cb.type, {
					...cb.payload,
					operation: cb.operation,
				});
				return { id: cb.id, result: callbackResult };
			})
		);

		return await this.resumeWithBatchResults(pausedResult.executionId, batchResults);
	}

	/**
	 * Handles a paused execution by processing the callback and resuming.
	 */
	private async handlePauseAndResume(pausedResult: ExecutionResult): Promise<ExecutionResult> {
		if (!pausedResult.needsCallback) {
			throw new Error('No callback request in paused execution');
		}

		try {
			const callbackResult = await this.serviceProviders.handleCallback(
				pausedResult.needsCallback.type,
				{
					...pausedResult.needsCallback.payload,
					operation: pausedResult.needsCallback.operation,
					executionId: pausedResult.executionId,
				}
			);

			return await this.resume(pausedResult.executionId, callbackResult);
		} catch (error) {
			if (error instanceof ClientCallbackError) {
				throw error;
			}
			return await this.resume(pausedResult.executionId, {
				__error: true,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Resumes a paused execution with a callback result.
	 */
	async resume(executionId: string, callbackResult: unknown): Promise<ExecutionResult> {
		await this.session.ensureInitialized();

		const url = `${this.session.getBaseUrl()}/api/resume/${executionId}`;
		const body = JSON.stringify({ result: callbackResult });
		const headers = await this.session.prepareHeaders('POST', url, body);

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body,
		});

		this.session.updateToken(response);

		if (!response.ok) {
			const error = (await response.json()) as { error: string };
			throw new Error(`Resume failed: ${error.error || response.statusText}`);
		}

		const result = (await response.json()) as ExecutionResult;

		if (result.provenanceTokens && result.provenanceTokens.length > 0) {
			for (const { token } of result.provenanceTokens) {
				this.tokenRegistry.add(token);
			}
		}

		if (result.status === ExecutionStatus.PAUSED && result.needsCallbacks) {
			return await this.handleBatchCallbacksAndResume(result);
		}

		if (result.status === ExecutionStatus.PAUSED && result.needsCallback) {
			return await this.handlePauseAndResume(result);
		}

		return result;
	}

	/**
	 * Resumes a paused execution with batch callback results.
	 */
	private async resumeWithBatchResults(
		executionId: string,
		batchResults: Array<{ id: string; result: unknown }>
	): Promise<ExecutionResult> {
		await this.session.ensureInitialized();

		const url = `${this.session.getBaseUrl()}/api/resume/${executionId}`;
		const body = JSON.stringify({ results: batchResults });
		const headers = await this.session.prepareHeaders('POST', url, body);

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body,
		});

		this.session.updateToken(response);

		if (!response.ok) {
			const error = (await response.json()) as { error: string };
			throw new Error(`Batch resume failed: ${error.error || response.statusText}`);
		}

		const result = (await response.json()) as ExecutionResult;

		if (result.provenanceTokens && result.provenanceTokens.length > 0) {
			for (const { token } of result.provenanceTokens) {
				this.tokenRegistry.add(token);
			}
		}

		if (result.status === ExecutionStatus.PAUSED && result.needsCallbacks) {
			return await this.handleBatchCallbacksAndResume(result);
		}

		if (result.status === ExecutionStatus.PAUSED && result.needsCallback) {
			return await this.handlePauseAndResume(result);
		}

		return result;
	}
}
