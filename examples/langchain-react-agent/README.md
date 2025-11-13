# LangChain React Agent with ATP

Production-ready examples of using Agent Tool Protocol with LangChain agents.

## Features

- ✅ **React Agent** - Uses LangChain's prebuilt React agent
- ✅ **ATP Tools** - Full access to ATP's code execution sandbox
- ✅ **LLM Sampling** - `atp.llm.call()` routes to LangChain LLM
- ✅ **Human-in-the-Loop** - LangGraph interrupts for approvals
- ✅ **State Persistence** - Checkpoint-based for production use
- ✅ **Token Refresh** - Automatic token refresh using preRequest hooks
- ✅ **Type Safety** - Full TypeScript support

## Examples

### 0. Integration Test (`simple-test.ts`)

Quick test to verify ATP + LangChain integration works:

```bash
npx tsx simple-test.ts
```

This demonstrates:

- Creating ATP tools for LangChain
- Running code that calls APIs and makes LLM calls
- Getting all 3 ATP tools automatically (search_api, fetch_all_apis, execute_code)

### 1. Simple Agent (`simple-agent.ts`)

Basic React agent without approval handling. **Demonstrates token refresh using preRequest hooks.**

```bash
npm run start:simple
```

Features:

- Token refresh simulation using `ClientHooks`
- Logs each token refresh before requests
- Shows how to integrate short-lived tokens (e.g., 3-minute TTL)
- Auto-approval for demo purposes

### 2. Production Agent (`agent.ts`)

Full production setup with:

- LangGraph interrupts for approvals
- Checkpoint persistence (MemorySaver)
- Error handling
- Terminal approval prompts

```bash
npm start
```

## Prerequisites

1. **Set OpenAI API Key**:

```bash
export OPENAI_API_KEY=sk-...
# Or create a .env file
cp env.example .env
# Then edit .env with your API key
```

2. **Start ATP Server**:

```bash
cd ../test-server
npx tsx server.ts
```

3. **Install Dependencies**:

```bash
npm install
```

## How It Works

### Token Refresh with Hooks

The `simple-agent.ts` example shows how to use `preRequest` hooks to automatically refresh short-lived tokens:

```typescript
import type { ClientHooks } from '@mondaydotcomorg/atp-client';

const hooks: ClientHooks = {
	preRequest: async (context) => {
		// Refresh token before each request
		const freshToken = await getAccessToken(); // Your auth service

		return {
			headers: {
				...context.currentHeaders,
				Authorization: `Bearer ${freshToken}`,
			},
		};
	},
};

const { tools } = await createATPTools({
	serverUrl: 'http://localhost:3333',
	llm,
	hooks, // Pass the hooks
	useLangGraphInterrupts: false,
});
```

This solves the problem of short-lived bearer tokens (e.g., 3-minute TTL) by automatically refreshing before every request.

### LLM Sampling

When ATP code calls `atp.llm.call()`, it's automatically routed to your LangChain LLM:

```typescript
// In ATP code:
const result = await atp.llm.call({
	prompt: 'What is 2+2?',
});
// → Uses your ChatOpenAI/Anthropic/etc. model
```

### Human-in-the-Loop Approvals

When ATP code calls `atp.approval.request()`, LangGraph interrupts:

```typescript
// In ATP code:
const approval = await atp.approval.request('Delete 100 records?', { count: 100 });
// → Triggers LangGraph interrupt
// → Agent pauses, waits for human decision
// → Resumes after approval/denial
```

### Production Pattern

```typescript
const { client, tools, isApprovalRequired, resumeWithApproval } =
  await createATPTools(serverUrl, apiKey, { llm });

const agent = createReactAgent({
  llm,
  tools,
  checkpointSaver: new PostgresSaver(...) // Persist state
});

try {
  await agent.invoke({ messages: [...] });
} catch (error) {
  if (isApprovalRequired(error)) {
    // Save approval request to database
    // Notify user via Slack/email
    // Wait for async approval
    // Resume: await resumeWithApproval(executionId, approved)
  }
}
```

## API Reference

### `createATPTools(serverUrl, apiKey, options)`

Creates LangChain tools with ATP integration.

**Options:**

- `llm` - LangChain LLM for sampling (required)
- `useLangGraphInterrupts` - Use interrupts for approvals (default: `true`)
- `approvalHandler` - Direct approval callback (if interrupts disabled)

**Returns:**

- `client` - LangGraphATPClient instance
- `tools` - Array of LangChain Tools (automatically converted from ATP tools)
- `isApprovalRequired` - Helper to check for approval exceptions
- `resumeWithApproval` - Helper to resume after approval

## Production Deployment

### 1. Use PostgreSQL Checkpointer

```typescript
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const checkpointer = new PostgresSaver({
	connectionString: process.env.DATABASE_URL,
});
```

### 2. Async Approval Flow

```typescript
// When approval is needed:
if (isApprovalRequired(error)) {
	// 1. Save to database
	await db.approvalRequests.create({
		executionId: error.approvalRequest.executionId,
		message: error.approvalRequest.message,
		context: error.approvalRequest.context,
		status: 'pending',
	});

	// 2. Notify user (Slack, email, etc.)
	await slack.send({
		text: `Approval needed: ${error.approvalRequest.message}`,
		blocks: [
			{
				type: 'actions',
				elements: [
					{ type: 'button', text: 'Approve', value: 'approve' },
					{ type: 'button', text: 'Deny', value: 'deny' },
				],
			},
		],
	});

	// 3. Wait for webhook callback
	// (Express endpoint receives Slack action)
}

// In webhook handler:
app.post('/approval-callback', async (req, res) => {
	const { executionId, action } = req.body;
	const approved = action === 'approve';

	// Resume execution
	const result = await resumeWithApproval(executionId, approved);

	res.json({ success: true, result });
});
```

### 3. Multiple Approvals

ATP supports multiple sequential approvals in a single execution:

```typescript
// In ATP code:
const approval1 = await atp.approval.request('Step 1 OK?');
// → Interrupt #1
const approval2 = await atp.approval.request('Step 2 OK?');
// → Interrupt #2
```

Each approval triggers a new interrupt and checkpoint.

## Troubleshooting

### "Approval service not provided"

You need to either:

1. Set `useLangGraphInterrupts: true` (default), OR
2. Provide `approvalHandler` callback

### "LLM service not provided"

You must provide an `llm` option when creating ATP tools.

### Connection errors

Ensure ATP server is running on `http://localhost:3333` or update the URL.

## Learn More

- [ATP Documentation](../../README.md)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraphjs/)
- [LangChain Tools](https://js.langchain.com/docs/modules/agents/tools/)
