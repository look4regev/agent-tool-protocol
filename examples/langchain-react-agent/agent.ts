/**
 * Production-Ready LangChain React Agent with ATP
 *
 * This example demonstrates a complete production setup with:
 * - React agent that uses ATP tools
 * - LangGraph interrupts for human-in-the-loop approvals
 * - Checkpoint-based state persistence (MemorySaver)
 * - Full ATP runtime support (atp.llm, atp.approval)
 * - Error handling and retries
 *
 * To run this example:
 * 1. Start an ATP server: cd examples/production-example && npm start
 * 2. Set OPENAI_API_KEY environment variable
 * 3. Run this script: npx tsx agent.ts
 */

import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { createATPTools, ApprovalRequiredException } from '@agent-tool-protocol/langchain';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import * as readline from 'readline';

// Define the state structure for our graph
const GraphState = Annotation.Root({
	messages: Annotation<any[]>({
		reducer: (left, right) => left.concat(right),
	}),
	approvalRequest: Annotation<any>({
		reducer: (_, right) => right,
	}),
	executionId: Annotation<string>({
		reducer: (_, right) => right,
	}),
});

/**
 * Helper to prompt user for approval in terminal
 */
async function promptForApproval(message: string, context?: any): Promise<boolean> {
	console.log('\n🚨 APPROVAL REQUIRED 🚨');
	console.log('═══════════════════════════════════════');
	console.log(`Message: ${message}`);
	if (context) {
		console.log(`Context: ${JSON.stringify(context, null, 2)}`);
	}
	console.log('═══════════════════════════════════════\n');

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question('Approve? (yes/no): ', (answer) => {
			rl.close();
			const approved = answer.toLowerCase().trim() === 'yes';
			console.log(approved ? '✅ Approved\n' : '❌ Denied\n');
			resolve(approved);
		});
	});
}

/**
 * Main function to run the agent
 */
async function main() {
	console.log('🚀 Starting LangChain React Agent with ATP Integration\n');

	// Check for API key
	if (!process.env.OPENAI_API_KEY) {
		console.error('❌ Error: OPENAI_API_KEY environment variable not set');
		process.exit(1);
	}

	// 1. Create LLM for the agent
	const llm = new ChatOpenAI({
		modelName: 'gpt-4.1',
		temperature: 0,
	});

	// 2. Create ATP tools with LangGraph interrupt support
	console.log('🔌 Connecting to ATP server at http://localhost:3333...');
	const { tools, isApprovalRequired, resumeWithApproval } = await createATPTools({
		serverUrl: 'http://localhost:3333',
		headers: { Authorization: 'Bearer demo-token' },
		llm,
		useLangGraphInterrupts: true, // Production mode: use interrupts
	});
	console.log(`✅ Connected to ATP server - ${tools.length} tools available\n`);

	// 3. Create checkpointer for state persistence
	const checkpointer = new MemorySaver();
	// For production, use PostgresSaver:
	// import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
	// const checkpointer = new PostgresSaver({ connectionString: process.env.DATABASE_URL });

	// 4. Create React agent with tools
	console.log('🤖 Creating React agent...');
	const agent = createReactAgent({
		llm,
		tools,
		checkpointSaver: checkpointer,
	});
	console.log('✅ Agent created\n');

	// 5. Run agent with approval handling
	const threadId = 'demo-thread-1';
	console.log(`📝 Thread ID: ${threadId}\n`);

	const userQuery = `
Use the ATP tools to perform the following task:

1. First, use atp.llm.call() to generate a creative product idea
2. Then, request approval from the user using atp.approval.request()
3. If approved, use atp.llm.call() again to create a marketing tagline

Write TypeScript code that does this in the ATP sandbox.
	`.trim();

	console.log('💬 User Query:');
	console.log(userQuery);
	console.log('\n' + '─'.repeat(80) + '\n');

	let config = {
		configurable: {
			thread_id: threadId,
		},
	};

	try {
		// Stream agent execution
		console.log('🎬 Agent execution started...\n');

		for await (const event of await agent.stream(
			{
				messages: [{ role: 'user', content: userQuery }],
			},
			config
		)) {
			// Log agent steps
			if (event.agent) {
				console.log('🤔 Agent thinking...');
			}
			if (event.tools) {
				const toolMessages = (event.tools as any).messages;
				if (toolMessages && Array.isArray(toolMessages) && toolMessages.length > 0) {
					console.log('🔧 Using tool:', toolMessages[0]?.name || 'unknown');
				}
			}
		}

		console.log('\n✅ Agent execution completed!\n');
	} catch (error: any) {
		if (isApprovalRequired(error)) {
			// Approval needed - this is expected in production
			const approvalReq = error.approvalRequest;
			console.log('\n⏸️  Execution paused for approval\n');

			// In production, you would:
			// 1. Save the approval request to database
			// 2. Send notification to user (Slack, email, etc.)
			// 3. Wait for async approval via API/webhook
			// 4. Resume execution when approved

			// For this demo, we'll use terminal prompt
			const approved = await promptForApproval(approvalReq.message, approvalReq.context);

			// Resume execution with approval decision
			console.log('▶️  Resuming execution...\n');
			const finalResult = await resumeWithApproval(
				approvalReq.executionId,
				approved,
				approved ? 'User approved via terminal' : 'User denied via terminal'
			);

			console.log('🎉 Final Result:');
			console.log(JSON.stringify(finalResult, null, 2));
			console.log('\n✅ Execution completed after approval!\n');
		} else {
			console.error('❌ Error:', error.message);
			console.error(error.stack);
		}
	}
}

// Run the example
main().catch(console.error);
