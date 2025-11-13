import type { RuntimeContext } from '../types.js';

const contextStack: RuntimeContext[] = [];

export function setRuntimeContext(context: RuntimeContext): void {
	contextStack.push(context);
}

export function getRuntimeContext(): RuntimeContext {
	const context = contextStack[contextStack.length - 1];
	if (!context) {
		throw new Error('No runtime context available. Compiler runtime not properly initialized.');
	}
	return context;
}

export function clearRuntimeContext(): void {
	contextStack.pop();
}

export function hasRuntimeContext(): boolean {
	return contextStack.length > 0;
}

let idCounter = 0;

export function generateUniqueId(prefix: string): string {
	return `${prefix}_${Date.now()}_${idCounter++}`;
}

export function resetIdCounter(): void {
	idCounter = 0;
}
