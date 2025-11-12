/**
 * Human Approval API Types
 */

export interface ApprovalRequest {
	message: string;
	context?: Record<string, unknown>;
	timeout?: number;
	schema?: ApprovalSchema;
}

export interface ApprovalSchema {
	type: 'boolean' | 'text' | 'choice' | 'structured';
	choices?: string[];
	structuredSchema?: Record<string, unknown>;
	required?: boolean;
}

export interface ApprovalResponse<T = unknown> {
	approved: boolean;
	response?: T;
	timestamp: number;
}
