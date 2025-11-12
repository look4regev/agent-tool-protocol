import { createATPTools } from './dist/langgraph-tools.js';
import { ChatOpenAI } from '@langchain/openai';
import { createServer as createATPServer, MB } from '@agent-tool-protocol/server';

// Start ATP server
const atpServer = createATPServer({
  execution: {
    timeout: 30000,
    memory: 128 * MB,
    llmCalls: 5,
  },
  logger: 'info',
});

await atpServer.listen(3333);
console.log('ATP server started on port 3333');

// Create tools
const llm = new ChatOpenAI({
  modelName: 'gpt-4o-mini',
  temperature: 0
});

const { tools } = await createATPTools('http://localhost:3333', '', { llm });

console.log('\nTools created:');
tools.forEach(tool => {
  console.log(`  - ${tool.name}`);
  console.log(`    Schema:`, JSON.stringify(tool.schema, null, 2));
});

// Test the search tool
const searchTool = tools.find(t => t.name === 'atp_search_api');
if (searchTool) {
  console.log('\nTesting search tool with {query: "test"}...');
  try {
    const result = await searchTool.invoke({ query: 'test' });
    console.log('Result:', result);
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

await atpServer.stop();
console.log('\nATP server stopped');
process.exit(0);
