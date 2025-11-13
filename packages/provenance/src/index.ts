export * from './types.js';

export {
	createProvenanceProxy,
	getProvenance,
	hasProvenance,
	getAllProvenance,
	canRead,
	getProvenanceForPrimitive,
	markPrimitiveTainted,
	isPrimitiveTainted,
	setProvenanceExecutionId,
	clearProvenanceExecutionId,
	registerProvenanceMetadata,
	cleanupProvenanceForExecution,
	captureProvenanceState,
	restoreProvenanceState,
	captureProvenanceSnapshot,
	restoreProvenanceSnapshot,
} from './registry.js';

export {
	issueProvenanceToken,
	verifyProvenanceToken,
	verifyProvenanceHints,
	computeDigest,
	stableStringify,
	getClientSecret,
	type TokenPayload,
} from './tokens.js';

export { SecurityPolicyEngine, type Logger } from './policies/engine.js';

export {
	preventDataExfiltration,
	preventDataExfiltrationWithApproval,
	requireUserOrigin,
	requireUserOriginWithApproval,
	blockLLMRecipients,
	blockLLMRecipientsWithApproval,
	auditSensitiveAccess,
	getBuiltInPolicies,
	getBuiltInPoliciesWithApproval,
	createCustomPolicy,
} from './policies/engine.js';

export { instrumentCode, createTrackingRuntime } from './ast/instrumentor.js';
