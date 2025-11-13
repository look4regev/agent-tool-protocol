/**
 * Security Policy Engine
 *
 */
import type { SecurityPolicy, PolicyResult, ProvenanceMetadata, PolicyAction } from '../types.js';
import { ProvenanceSecurityError, ProvenanceSource } from '../types.js';
import {
	getProvenance,
	getAllProvenance,
	canRead,
	getProvenanceForPrimitive,
} from '../registry.js';

export interface Logger {
	debug: (msg: string, obj?: any) => void;
	info: (msg: string, obj?: any) => void;
	warn: (msg: string, obj?: any) => void;
	error: (msg: string, obj?: any) => void;
}

export class SecurityPolicyEngine {
	private policies: SecurityPolicy[];
	private logger: Logger;
	private approvalCallback?: (
		message: string,
		context: Record<string, unknown>
	) => Promise<boolean>;
	private customGetProvenance?: (value: unknown) => any;

	constructor(
		policies: SecurityPolicy[],
		logger: Logger,
		customGetProvenance?: (value: unknown) => any
	) {
		this.policies = policies;
		this.logger = logger;
		this.customGetProvenance = customGetProvenance;
	}

	/**
	 * Set a custom getProvenance function (e.g., for AST mode)
	 */
	setGetProvenance(fn: (value: unknown) => any): void {
		this.customGetProvenance = fn;
	}

	/**
	 * Set approval callback for policies that return action='approve'
	 */
	setApprovalCallback(
		callback: (message: string, context: Record<string, unknown>) => Promise<boolean>
	): void {
		this.approvalCallback = callback;
	}

	async checkTool(
		toolName: string,
		apiGroup: string,
		args: Record<string, unknown>
	): Promise<void> {
		this.logger.debug('Checking security policies', {
			toolName,
			apiGroup,
			policyCount: this.policies.length,
		});

		// Use custom getProvenance if available, otherwise use default
		const getProvenanceFn = this.customGetProvenance || getProvenance;

		for (const policy of this.policies) {
			const result = await policy.check(toolName, args, getProvenanceFn);

			const action = this.normalizeAction(result);

			if (action === 'block') {
				this.logger.warn('Security policy blocked tool execution', {
					toolName,
					apiGroup,
					policy: policy.name,
					reason: result.reason,
				});

				throw new ProvenanceSecurityError(
					result.reason || `Policy ${policy.name} denied execution`,
					policy.name,
					toolName,
					{ apiGroup, args: this.sanitizeArgs(args), context: result.context }
				);
			}

			if (action === 'approve') {
				this.logger.info('Security policy requires approval', {
					toolName,
					apiGroup,
					policy: policy.name,
					reason: result.reason,
				});

				const approved = await this.requestApproval(toolName, apiGroup, policy.name, result);

				if (!approved) {
					this.logger.warn('Security policy approval denied', {
						toolName,
						apiGroup,
						policy: policy.name,
					});

					throw new ProvenanceSecurityError(
						`Approval denied: ${result.reason || 'Operation requires approval'}`,
						policy.name,
						toolName,
						{ apiGroup, args: this.sanitizeArgs(args), approvalDenied: true }
					);
				}

				this.logger.info('Security policy approval granted', {
					toolName,
					apiGroup,
					policy: policy.name,
				});
			}

			if (action === 'log') {
				this.logger.warn('Security policy audit event', {
					toolName,
					apiGroup,
					policy: policy.name,
					reason: result.reason,
					context: result.context,
					args: this.sanitizeArgs(args),
				});
			}
		}

		this.logger.debug('All security policies passed', { toolName, apiGroup });
	}

	private normalizeAction(result: PolicyResult): PolicyAction {
		if (result.action) {
			return result.action;
		}

		if (result.allowed !== undefined) {
			return result.allowed ? 'log' : 'block';
		}

		return 'log';
	}

	private async requestApproval(
		toolName: string,
		apiGroup: string,
		policyName: string,
		result: PolicyResult
	): Promise<boolean> {
		if (!this.approvalCallback) {
			this.logger.error('Approval required but no callback configured', {
				toolName,
				policy: policyName,
			});
			throw new ProvenanceSecurityError(
				'Approval required but approval handler not configured',
				policyName,
				toolName,
				{ requiresApproval: true }
			);
		}

		const message = result.reason || `Policy ${policyName} requires approval for ${toolName}`;
		const context = {
			toolName,
			apiGroup,
			policy: policyName,
			...(result.context || {}),
		};

		try {
			return await this.approvalCallback(message, context);
		} catch (error) {
			this.logger.error('Approval request failed', { error, toolName, policy: policyName });
			return false;
		}
	}

	private sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
		const sanitized: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(args)) {
			if (typeof value === 'string' && value.length > 100) {
				sanitized[key] = value.substring(0, 100) + '...';
			} else if (typeof value === 'object') {
				sanitized[key] = '[object]';
			} else {
				sanitized[key] = value;
			}
		}
		return sanitized;
	}
}

/**
 * Built-in Security Policies
 */

/**
 * Helper: Get all provenance from args object, including scanning all nested values
 * This catches primitives that came from tool-originated objects
 */
function getAllProvenanceFromArgs(
	args: Record<string, unknown>,
	getProvenance: (value: unknown) => any
): any[] {
	const allProvenance: any[] = [];
	const visited = new Set<any>();

	function scan(value: unknown) {
		if (value === null || value === undefined) return;

		if (typeof value === 'string' || typeof value === 'number') {
			try {
				const primitiveProv = getProvenance(value);
				if (primitiveProv) {
					allProvenance.push(primitiveProv);
				}
			} catch (error) {
				// Ignore errors during provenance lookup
			}
			return;
		}

		if (typeof value !== 'object') return;
		if (visited.has(value)) return;
		visited.add(value);

		const provenance = getProvenance(value);
		if (provenance) {
			allProvenance.push(provenance);
		}

		if (Array.isArray(value)) {
			for (const item of value) {
				scan(item);
			}
		} else {
			for (const key in value) {
				if (Object.prototype.hasOwnProperty.call(value, key)) {
					scan((value as any)[key]);
				}
			}
		}
	}

	for (const key in args) {
		if (Object.prototype.hasOwnProperty.call(args, key)) {
			scan(args[key]);
		}
	}

	return allProvenance;
}

/**
 * Prevent data exfiltration - blocks sending private data to unauthorized recipients
 */
export const preventDataExfiltration: SecurityPolicy = {
	name: 'prevent-data-exfiltration',
	description: 'Prevents sending data to recipients who cannot read it',
	check: (toolName, args, getProvenance) => {
		const recipientKeys = ['to', 'recipient', 'recipients', 'email', 'address'];
		const dataKeys = ['body', 'message', 'content', 'data', 'payload'];

		let recipient: string | null = null;
		for (const key of recipientKeys) {
			if (args[key] && typeof args[key] === 'string') {
				recipient = args[key] as string;
				break;
			}
		}

		if (!recipient) {
			return { action: 'log' as PolicyAction };
		}

		const allProvenance = getAllProvenanceFromArgs(args, getProvenance);

		for (const metadata of allProvenance) {
			if (metadata.source.type === ProvenanceSource.TOOL) {
				if (metadata.readers.type === 'restricted') {
					if (!canRead(recipient, metadata.readers)) {
						return {
							action: 'block' as PolicyAction,
							reason: `Recipient "${recipient}" cannot read data from ${metadata.source.toolName}. Authorized readers: ${metadata.readers.readers.join(', ')}`,
							policy: 'prevent-data-exfiltration',
							context: {
								recipient,
								toolSource: metadata.source.toolName,
								authorizedReaders: metadata.readers.readers,
							},
						};
					}
				}
			}
		}

		return { action: 'log' as PolicyAction };
	},
};

/**
 * Prevent data exfiltration (approval mode) - requires approval for risky sends
 */
export const preventDataExfiltrationWithApproval: SecurityPolicy = {
	name: 'prevent-data-exfiltration-approval',
	description: 'Requires approval for sending data to recipients who cannot read it',
	check: (toolName, args, getProvenance) => {
		const recipientKeys = ['to', 'recipient', 'recipients', 'email', 'address'];

		let recipient: string | null = null;
		for (const key of recipientKeys) {
			if (args[key] && typeof args[key] === 'string') {
				recipient = args[key] as string;
				break;
			}
		}

		if (!recipient) {
			return { action: 'log' as PolicyAction };
		}

		const allProvenance = getAllProvenanceFromArgs(args, getProvenance);

		for (const metadata of allProvenance) {
			if (metadata.source.type === ProvenanceSource.TOOL) {
				if (metadata.readers.type === 'restricted') {
					if (!canRead(recipient, metadata.readers)) {
						return {
							action: 'approve' as PolicyAction,
							reason: `Sending data from ${metadata.source.toolName} to "${recipient}" (not in authorized readers)`,
							policy: 'prevent-data-exfiltration-approval',
							context: {
								recipient,
								toolSource: metadata.source.toolName,
								authorizedReaders: metadata.readers.readers,
								sensitiveFields: Object.keys(args).filter((k) => args[k] !== null),
							},
						};
					}
				}
			}
		}

		return { action: 'log' as PolicyAction };
	},
};

/**
 * Require user origin - ensures sensitive operations only use user-provided data
 */
export const requireUserOrigin: SecurityPolicy = {
	name: 'require-user-origin',
	description: 'Requires critical parameters to come directly from user input',
	check: (toolName, args, getProvenance) => {
		const criticalTools = ['deleteDatabase', 'dropTable', 'executeSQL', 'sendMoney', 'transfer'];

		if (!criticalTools.some((t) => toolName.toLowerCase().includes(t.toLowerCase()))) {
			return { action: 'log' as PolicyAction };
		}

		for (const [key, value] of Object.entries(args)) {
			const allProvenance = getAllProvenance(value);

			for (const metadata of allProvenance) {
				if (
					metadata.source.type !== ProvenanceSource.USER &&
					metadata.source.type !== ProvenanceSource.SYSTEM
				) {
					return {
						action: 'block' as PolicyAction,
						reason: `Critical tool "${toolName}" parameter "${key}" must come from user input, but came from ${metadata.source.type}`,
						policy: 'require-user-origin',
						context: {
							toolName,
							parameterKey: key,
							actualSource: metadata.source.type,
						},
					};
				}
			}
		}

		return { action: 'log' as PolicyAction };
	},
};

/**
 * Require user origin (approval mode) - requires approval for non-user-originated critical operations
 */
export const requireUserOriginWithApproval: SecurityPolicy = {
	name: 'require-user-origin-approval',
	description: 'Requires approval for critical operations with non-user data',
	check: (toolName, args, getProvenance) => {
		const criticalTools = ['deleteDatabase', 'dropTable', 'executeSQL', 'sendMoney', 'transfer'];

		if (!criticalTools.some((t) => toolName.toLowerCase().includes(t.toLowerCase()))) {
			return { action: 'log' as PolicyAction };
		}

		for (const [key, value] of Object.entries(args)) {
			const allProvenance = getAllProvenance(value);

			for (const metadata of allProvenance) {
				if (
					metadata.source.type !== ProvenanceSource.USER &&
					metadata.source.type !== ProvenanceSource.SYSTEM
				) {
					return {
						action: 'approve' as PolicyAction,
						reason: `Critical operation "${toolName}" with parameter "${key}" from ${metadata.source.type} source`,
						policy: 'require-user-origin-approval',
						context: {
							toolName,
							parameterKey: key,
							actualSource: metadata.source.type,
							value: String(value).substring(0, 100),
						},
					};
				}
			}
		}

		return { action: 'log' as PolicyAction };
	},
};

/**
 * Block LLM-generated recipients - prevents sending to LLM-extracted emails
 */
export const blockLLMRecipients: SecurityPolicy = {
	name: 'block-llm-recipients',
	description: 'Blocks sending data to LLM-extracted email addresses',
	check: (toolName, args, getProvenance) => {
		const recipientKeys = ['to', 'recipient', 'recipients', 'email'];

		for (const key of recipientKeys) {
			if (!args[key]) continue;

			const metadata = getProvenance(args[key]);
			if (metadata && metadata.source.type === ProvenanceSource.LLM) {
				return {
					action: 'block' as PolicyAction,
					reason: `Cannot send to LLM-extracted recipient in parameter "${key}". Recipients must come from user input or trusted sources.`,
					policy: 'block-llm-recipients',
					context: {
						parameterKey: key,
						recipientValue: String(args[key]).substring(0, 50),
					},
				};
			}
		}

		return { action: 'log' as PolicyAction };
	},
};

/**
 * Block LLM-generated recipients (approval mode) - requires approval for LLM-extracted emails
 */
export const blockLLMRecipientsWithApproval: SecurityPolicy = {
	name: 'block-llm-recipients-approval',
	description: 'Requires approval for sending to LLM-extracted email addresses',
	check: (toolName, args, getProvenance) => {
		const recipientKeys = ['to', 'recipient', 'recipients', 'email'];

		for (const key of recipientKeys) {
			if (!args[key]) continue;

			const metadata = getProvenance(args[key]);
			if (metadata && metadata.source.type === ProvenanceSource.LLM) {
				return {
					action: 'approve' as PolicyAction,
					reason: `Sending to LLM-extracted recipient "${args[key]}" in parameter "${key}"`,
					policy: 'block-llm-recipients-approval',
					context: {
						parameterKey: key,
						recipientValue: String(args[key]),
						llmOperation: (metadata.source as any).operation,
					},
				};
			}
		}

		return { action: 'log' as PolicyAction };
	},
};

/**
 * Audit sensitive data access - logs access without blocking
 */
export const auditSensitiveAccess: SecurityPolicy = {
	name: 'audit-sensitive-access',
	description: 'Logs access to sensitive data (does not block)',
	check: (toolName, args, getProvenance) => {
		const sensitiveTools = ['getPassword', 'getCreditCard', 'getSSN', 'getBankAccount'];

		if (sensitiveTools.some((t) => toolName.toLowerCase().includes(t.toLowerCase()))) {
			const allProvenance = getAllProvenance(args);

			return {
				action: 'log' as PolicyAction,
				reason: `Sensitive data accessed via ${toolName}`,
				policy: 'audit-sensitive-access',
				context: {
					toolName,
					provenanceChain: allProvenance.map((p) => ({
						source: p.source,
						id: p.id,
					})),
				},
			};
		}

		return { action: 'log' as PolicyAction };
	},
};

/**
 * Helper: Create custom policy
 */
export function createCustomPolicy(
	name: string,
	description: string,
	checkFn: SecurityPolicy['check']
): SecurityPolicy {
	return { name, description, check: checkFn };
}

/**
 * Get all built-in policies
 */
export function getBuiltInPolicies(): SecurityPolicy[] {
	return [preventDataExfiltration, requireUserOrigin, blockLLMRecipients, auditSensitiveAccess];
}

/**
 * Get all built-in policies with approval variants
 */
export function getBuiltInPoliciesWithApproval(): SecurityPolicy[] {
	return [
		preventDataExfiltrationWithApproval,
		requireUserOriginWithApproval,
		blockLLMRecipientsWithApproval,
		auditSensitiveAccess,
	];
}
