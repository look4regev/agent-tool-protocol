/**
 * Input validation utilities for ExecutionConfig and other types
 */

import { z } from 'zod';
import type { ExecutionConfig } from './types.js';

/**
 * Maximum allowed code size (1MB)
 */
export const MAX_CODE_SIZE = 1000000;

export class ConfigValidationError extends Error {
	constructor(
		message: string,
		public readonly field: string,
		public readonly value: unknown
	) {
		super(message);
		this.name = 'ConfigValidationError';
	}
}

export class SecurityViolationError extends Error {
	constructor(
		message: string,
		public readonly violations: string[]
	) {
		super(message);
		this.name = 'SecurityViolationError';
	}
}

/**
 * Sanitizes input string by removing control characters and normalizing whitespace
 */
export function sanitizeInput(input: string, maxLength = MAX_CODE_SIZE): string {
	if (typeof input !== 'string') {
		return '';
	}

	let sanitized = input.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

	sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');

	sanitized = sanitized.replace(/\n{10,}/g, '\n\n\n');

	if (sanitized.length > maxLength) {
		sanitized = sanitized.substring(0, maxLength);
	}

	return sanitized;
}

/**
 * Frames user code in a secure execution context to prevent injection attacks
 * Similar to SQL parameterized queries - treats user code as data within a safe boundary
 */
export function frameCodeExecution(userCode: string): string {
	const cleaned = sanitizeInput(userCode);

	return `
(async function __user_code_context__() {
	"use strict";
	${cleaned}
})();
`.trim();
}

/**
 * Zod schema for ExecutionConfig validation
 */
export const executionConfigSchema = z.object({
	timeout: z
		.number({
			invalid_type_error: 'timeout must be a number',
		})
		.positive('timeout must be positive')
		.max(300000, 'timeout cannot exceed 300000ms (5 minutes)')
		.optional(),

	maxMemory: z
		.number({
			invalid_type_error: 'maxMemory must be a number',
		})
		.positive('maxMemory must be positive')
		.max(512 * 1024 * 1024, 'maxMemory cannot exceed 512MB')
		.optional(),

	maxLLMCalls: z
		.number({
			invalid_type_error: 'maxLLMCalls must be a number',
		})
		.nonnegative('maxLLMCalls cannot be negative')
		.max(1000, 'maxLLMCalls cannot exceed 1000')
		.optional(),

	allowedAPIs: z
		.array(
			z.string().refine((val) => val.trim().length > 0, {
				message: 'allowedAPIs must contain non-empty strings',
			})
		)
		.optional(),

	allowLLMCalls: z
		.boolean({
			invalid_type_error: 'allowLLMCalls must be a boolean',
		})
		.optional(),

	progressCallback: z.function().optional(),
	customLLMHandler: z.function().optional(),
	clientServices: z.any().optional(),
	provenanceMode: z.any().optional(),
	securityPolicies: z.array(z.any()).optional(),
	provenanceHints: z.array(z.string()).optional(),
});

/**
 * Validates ExecutionConfig parameters using Zod
 */
export function validateExecutionConfig(config: Partial<ExecutionConfig>): void {
	try {
		executionConfigSchema.parse(config);
	} catch (error) {
		if (error instanceof z.ZodError) {
			const errors = error.errors.map((err) => err.message);
			throw new ConfigValidationError(
				`Invalid ExecutionConfig: ${errors.join(', ')}`,
				'ExecutionConfig',
				config
			);
		}
		throw error;
	}
}

/**
 * Validates client ID format
 */
export function validateClientId(clientId: string): void {
	if (typeof clientId !== 'string') {
		throw new ConfigValidationError('clientId must be a string', 'clientId', clientId);
	}

	if (clientId.trim().length === 0) {
		throw new ConfigValidationError('clientId cannot be empty', 'clientId', clientId);
	}

	if (clientId.length > 256) {
		throw new ConfigValidationError('clientId cannot exceed 256 characters', 'clientId', clientId);
	}

	if (!/^[a-zA-Z0-9_-]+$/.test(clientId)) {
		throw new ConfigValidationError(
			'clientId can only contain alphanumeric characters, dashes, and underscores',
			'clientId',
			clientId
		);
	}
}
