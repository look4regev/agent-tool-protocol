import { AgentToolProtocolClient } from './client.js';

export class CodeGenerator {
	private client: AgentToolProtocolClient;

	constructor(client: AgentToolProtocolClient) {
		this.client = client;
	}

	async generateCode(intent: string, parameters?: unknown): Promise<string> {
		const types = this.client.getTypeDefinitions();
		console.log('Generating code for intent:', intent, parameters, types);
		return '// Generated code';
	}
}
