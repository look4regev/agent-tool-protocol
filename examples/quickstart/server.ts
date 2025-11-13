/**
 * Quickstart Example - Get started in 3 lines
 * Shows the simplest possible ATP server with custom tools
 */

import { createServer } from '@mondaydotcomorg/atp-server';

const server = createServer();

server.tool('greet', {
	description: 'Greet someone by name',
	input: { name: 'string' },
	handler: async (input: unknown) => {
		const { name } = input as { name: string };
		return `Hello, ${name}!`;
	},
});

server.tool('calculate', {
	description: 'Perform a simple calculation',
	input: {
		operation: 'string',
		a: 'number',
		b: 'number',
	},
	handler: async (input: unknown) => {
		const { operation, a, b } = input as { operation: string; a: number; b: number };
		switch (operation) {
			case 'add':
				return { result: a + b };
			case 'subtract':
				return { result: a - b };
			case 'multiply':
				return { result: a * b };
			case 'divide':
				return { result: a / b };
			default:
				throw new Error('Invalid operation');
		}
	},
});

await server.listen(3000);
console.log('Try: http://localhost:3000/api/info');
