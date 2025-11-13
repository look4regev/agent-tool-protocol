import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import {
	ToolOperationType,
	ToolSensitivityLevel,
	type ClientTool,
} from '@agent-tool-protocol/protocol';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Example client with local file system and system info tools
 */

// Define client tools that execute locally
const clientTools: ClientTool[] = [
	{
		name: 'readLocalFile',
		namespace: 'client',
		description: 'Read a file from the local filesystem',
		inputSchema: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path to the file to read',
				},
			},
			required: ['path'],
		},
		metadata: {
			operationType: ToolOperationType.READ,
			sensitivityLevel: ToolSensitivityLevel.SENSITIVE,
		},
		handler: async (input: any) => {
			console.log(`📖 Reading local file: ${input.path}`);
			try {
				const content = await fs.readFile(input.path, 'utf-8');
				return {
					success: true,
					content,
					path: input.path,
					size: content.length,
				};
			} catch (error: any) {
				return {
					success: false,
					error: error.message,
					path: input.path,
				};
			}
		},
	},
	{
		name: 'writeLocalFile',
		namespace: 'client',
		description: 'Write content to a file on the local filesystem',
		inputSchema: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path where to write the file',
				},
				content: {
					type: 'string',
					description: 'Content to write',
				},
			},
			required: ['path', 'content'],
		},
		metadata: {
			operationType: ToolOperationType.WRITE,
			sensitivityLevel: ToolSensitivityLevel.INTERNAL,
		},
		handler: async (input: any) => {
			console.log(`✍️  Writing local file: ${input.path}`);
			try {
				await fs.writeFile(input.path, input.content, 'utf-8');
				return {
					success: true,
					path: input.path,
					bytesWritten: input.content.length,
				};
			} catch (error: any) {
				return {
					success: false,
					error: error.message,
					path: input.path,
				};
			}
		},
	},
	{
		name: 'getSystemInfo',
		namespace: 'system',
		description: 'Get information about the client system',
		inputSchema: {
			type: 'object',
			properties: {},
		},
		metadata: {
			operationType: ToolOperationType.READ,
			sensitivityLevel: ToolSensitivityLevel.INTERNAL,
		},
		handler: async () => {
			console.log('ℹ️  Getting system info');
			return {
				platform: os.platform(),
				arch: os.arch(),
				hostname: os.hostname(),
				cpus: os.cpus().length,
				totalMemory: os.totalmem(),
				freeMemory: os.freemem(),
				uptime: os.uptime(),
			};
		},
	},
];

async function main() {
	console.log('🔧 Initializing ATP client with local tools...\n');

	// Create client with tools
	const client = new AgentToolProtocolClient({
		baseUrl: 'http://localhost:3333',
		serviceProviders: {
			tools: clientTools,
		},
	});

	// Initialize and register tools with server
	await client.init({
		name: 'client-tools-example',
		version: '1.0.0',
	});

	console.log('✅ Client initialized with tools:');
	clientTools.forEach((tool) => {
		console.log(`   - ${tool.namespace}.${tool.name}`);
	});
	console.log();

	// Example 1: Basic file operations
	console.log('📝 Example 1: File Operations\n');

	const tempDir = os.tmpdir();
	const testFile = path.join(tempDir, 'atp-test.txt');
	const outputFile = path.join(tempDir, 'atp-output.txt');

	// Write initial test file
	await fs.writeFile(testFile, 'Hello from ATP!', 'utf-8');

	const code1 = `
// Read the test file
const fileData = await api.client.readLocalFile({ 
	path: '${testFile}' 
});

console.log('File content:', fileData.content);

// Transform the content
const transformed = fileData.content.toUpperCase() + ' (TRANSFORMED)';

// Write to output file
const writeResult = await api.client.writeLocalFile({
	path: '${outputFile}',
	content: transformed
});

return {
	originalContent: fileData.content,
	transformedContent: transformed,
	outputPath: writeResult.path
};
`;

	const result1 = await client.execute(code1);
	console.log('Result:', JSON.stringify(result1.result, null, 2));
	console.log();

	// Example 2: System info
	console.log('💻 Example 2: System Information\n');

	const code2 = `
// Get system information
const sysInfo = await api.system.getSystemInfo();

// Format the information
const formatted = {
	os: \`\${sysInfo.platform} (\${sysInfo.arch})\`,
	hostname: sysInfo.hostname,
	cpus: sysInfo.cpus,
	memoryGB: (sysInfo.totalMemory / (1024 ** 3)).toFixed(2),
	freeMemoryGB: (sysInfo.freeMemory / (1024 ** 3)).toFixed(2),
	uptimeDays: (sysInfo.uptime / (60 * 60 * 24)).toFixed(2)
};

return formatted;
`;

	const result2 = await client.execute(code2);
	console.log('System Info:', JSON.stringify(result2.result, null, 2));
	console.log();

	// Example 3: Combined workflow
	console.log('🔄 Example 3: Combined Workflow\n');

	const code3 = `
// Get system info
const sysInfo = await api.system.getSystemInfo();

// Create a report
const report = \`System Report
=============
Hostname: \${sysInfo.hostname}
Platform: \${sysInfo.platform}
CPUs: \${sysInfo.cpus}
Memory: \${(sysInfo.totalMemory / (1024 ** 3)).toFixed(2)} GB

Generated at: \${new Date().toISOString()}
\`;

// Write report to file
const reportPath = '${path.join(tempDir, 'system-report.txt')}';
await api.client.writeLocalFile({
	path: reportPath,
	content: report
});

// Read it back to verify
const verification = await api.client.readLocalFile({
	path: reportPath
});

return {
	reportGenerated: true,
	reportPath,
	reportSize: verification.size,
	preview: report.substring(0, 100) + '...'
};
`;

	const result3 = await client.execute(code3);
	console.log('Workflow Result:', JSON.stringify(result3.result, null, 2));
	console.log();

	console.log('✨ All examples completed successfully!');
	console.log(`📁 Check ${tempDir} for generated files`);

	process.exit(0);
}

main().catch((error) => {
	console.error('Client error:', error);
	process.exit(1);
});
