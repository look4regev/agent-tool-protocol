import { AgentToolProtocolClient } from '@agent-tool-protocol/client';
import { ExecutionStatus } from '@agent-tool-protocol/protocol';

/**
 * LangGraph-compatible node for ATP execution
 */
export class ATPExecutionNode {
	private client: AgentToolProtocolClient;

	constructor(client: AgentToolProtocolClient) {
		this.client = client;
	}

	/**
	 * Execute code from the state and update the state with results
	 */
	async execute(state: { code?: string; messages?: any[]; [key: string]: any }): Promise<any> {
		if (!state.code) {
			throw new Error('No code provided in state');
		}

		const result = await this.client.execute(state.code);

		return {
			...state,
			executionResult: result,
			lastExecutionStatus: result.status,
			lastExecutionOutput:
				result.status === ExecutionStatus.COMPLETED ? result.result : result.error,
		};
	}

	/**
	 * Create a function suitable for LangGraph node
	 */
	asFunction() {
		return this.execute.bind(this);
	}
}

/**
 * Helper to create a simple ATP execution node function
 */
export function createATPNode(client: AgentToolProtocolClient) {
	return async (state: any) => {
		if (!state.code) {
			throw new Error('No code provided in state');
		}

		const result = await client.execute(state.code);

		return {
			...state,
			executionResult: result,
			lastExecutionStatus: result.status,
			lastExecutionOutput:
				result.status === ExecutionStatus.COMPLETED ? result.result : result.error,
		};
	};
}
