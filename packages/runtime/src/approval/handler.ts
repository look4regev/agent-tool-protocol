/**
 */
import type { ApprovalRequest, ApprovalResponse } from './types';

/**
 * Global approval handler that must be set by the execution context
 */
let approvalHandler: ((request: ApprovalRequest) => Promise<ApprovalResponse>) | null = null;

/**
 * Initialize the approval system with a custom handler
 */
export function initializeApproval(
	handler: (request: ApprovalRequest) => Promise<ApprovalResponse>
): void {
	approvalHandler = handler;
}

/**
 * Get the current approval handler
 */
export function getApprovalHandler():
	| ((request: ApprovalRequest) => Promise<ApprovalResponse>)
	| null {
	return approvalHandler;
}
