# Client-Provided Tools Example

This example demonstrates how to register and use client-provided tools that execute locally on the client side while maintaining full ATP security and provenance tracking.

## Overview

Client tools allow you to:

- Execute tools locally on the client (e.g., file system access, browser automation)
- Maintain security policies and provenance tracking
- Use the pause/resume mechanism for seamless execution
- Keep sensitive operations client-side

## Example Tools

This example includes three client tools:

1. **`client.readLocalFile`** - Reads a file from the client's local filesystem
2. **`client.writeLocalFile`** - Writes a file to the client's local filesystem
3. **`system.getSystemInfo`** - Gets system information from the client machine

## Running the Example

1. Install dependencies:

```bash
cd examples/client-tools
npm install
```

2. Start the ATP server:

```bash
npm run server
```

3. In another terminal, run the client:

```bash
npm run client
```

## How It Works

### 1. Client Registers Tools

The client defines tools with handlers and metadata:

```typescript
const clientTools: ClientTool[] = [
	{
		name: 'readLocalFile',
		namespace: 'client',
		description: 'Read a file from the local filesystem',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string' },
			},
			required: ['path'],
		},
		metadata: {
			operationType: ToolOperationType.READ,
			sensitivityLevel: ToolSensitivityLevel.SENSITIVE,
		},
		handler: async (input: any) => {
			const content = await fs.readFile(input.path, 'utf-8');
			return { content, path: input.path };
		},
	},
];
```

### 2. Client Initializes with Tools

```typescript
const client = new AgentToolProtocolClient({
	baseUrl: 'http://localhost:3333',
	serviceProviders: {
		tools: clientTools,
	},
});

await client.init();
```

### 3. Code Uses Client Tools

```typescript
const code = `
  // Read a local file using client tool
  const file = await api.client.readLocalFile({ 
    path: '/tmp/test.txt' 
  });
  
  // Process the content
  const processed = file.content.toUpperCase();
  
  // Write back using client tool
  await api.client.writeLocalFile({
    path: '/tmp/output.txt',
    content: processed
  });
  
  return { success: true };
`;

const result = await client.execute(code);
```

### 4. Execution Flow

1. Code calls `api.client.readLocalFile()`
2. Server pauses execution with `CallbackType.TOOL`
3. Server returns callback request to client
4. Client executes tool handler locally
5. Client sends result back via `/api/resume`
6. Server resumes execution with the result
7. Process continues seamlessly

## Security Features

Client tools support the same security features as server tools:

- **Tool Metadata**: `operationType`, `sensitivityLevel`, `requiresApproval`
- **Security Policies**: Apply custom policies to client tools
- **Provenance Tracking**: Track data flow from client tools
- **OAuth Scopes**: Require specific permissions

## Advanced Usage

### Custom Namespaces

Group related tools under custom namespaces:

```typescript
{
  name: 'openBrowser',
  namespace: 'playwright',  // Custom namespace
  description: 'Open a browser with Playwright',
  // ...
}
```

Access as: `api.playwright.openBrowser()`

### Approval Required

Mark tools as requiring approval:

```typescript
{
  name: 'deleteFile',
  metadata: {
    operationType: ToolOperationType.DESTRUCTIVE,
    requiresApproval: true,
  },
  // ...
}
```

### Provenance Tracking

Use with provenance mode to track data:

```typescript
const result = await client.execute(code, {
	provenanceMode: ProvenanceMode.PROXY,
	securityPolicies: [preventDataExfiltration],
});
```

## See Also

- [Client Tools Guide](../../docs/client-tools-guide.md)
- [Pause/Resume Guide](../../docs/pause-resume-guide.md)
- [Security Integration](../../docs/security-integration.md)
