/**
 * Types for code instrumentation and state capture system
 */

export interface InstrumentationMetadata {
	statements: StatementMetadata[];
	variables: Set<string>;
	functions: FunctionMetadata[];
}

export interface StatementMetadata {
	id: number;
	line?: number;
	type: string;
}

export interface FunctionMetadata {
	name: string;
	line?: number;
}

export interface InstrumentedCode {
	code: string;
	sourceMap?: any;
	metadata: InstrumentationMetadata;
}

export interface SerializedValue {
	type:
		| 'primitive'
		| 'object'
		| 'array'
		| 'function'
		| 'date'
		| 'regexp'
		| 'map'
		| 'set'
		| 'circular'
		| 'nonserializable';
	value?: unknown;
	className?: string;
	properties?: Record<string, SerializedValue>;
	source?: string;
	closure?: Record<string, SerializedValue>;
	isAsync?: boolean;
	isGenerator?: boolean;
	isArrow?: boolean;
	pattern?: string;
	flags?: string;
	entries?: Array<[SerializedValue, SerializedValue]>;
	items?: SerializedValue[];
	refId?: string;
}

export interface ExecutionState {
	executionId: string;
	clientId: string;
	currentStatementId: number;
	statements: Array<[number, StatementState]>;
	variables: Array<[string, SerializedValue]>;
	controlFlow: BranchDecision[];
}

export interface StatementState {
	id: number;
	executed: boolean;
	variables: Record<string, SerializedValue>;
	result?: SerializedValue;
	timestamp: number;
}

export interface BranchDecision {
	statementId: number;
	taken: boolean;
	timestamp: number;
}
