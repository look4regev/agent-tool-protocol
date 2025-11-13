const path = require('path');
const fs = require('fs');

module.exports = (request, options) => {
	// Fix ALL @babel/* imports to use compiled lib files instead of src
	// This is CRITICAL - Jest cannot handle @babel/* TypeScript source files
	if (request === '@babel/traverse' || request.startsWith('@babel/')) {
		// Force use of the default export from the main entry point
		try {
			const pkgName = request.split('/').slice(0, 2).join('/');
			const pkgPath = require.resolve(pkgName, { paths: [options.basedir] });
			return pkgPath;
		} catch (e) {
			// Fall through to default resolver
		}
	}

	// Fix broken @babel/* imports - they have TypeScript source files that Jest can't handle
	// Solution: redirect all @babel imports to use the compiled lib files instead of src
	if (options.basedir.includes('node_modules/@babel/')) {
		// If we're in a lib directory and the request is relative, stay in lib!
		if (
			options.basedir.includes('/lib') &&
			(request.startsWith('./') || request.startsWith('../'))
		) {
			const resolved = path.resolve(options.basedir, request);

			// If it exists without extension, return it
			if (fs.existsSync(resolved)) {
				return resolved;
			}
			// Try with .js extension
			if (fs.existsSync(resolved + '.js')) {
				return resolved + '.js';
			}
			// If not found, let default resolver handle it (it will fail properly)
		}
	}

	// Only process paths within our packages directory
	if (request.startsWith('.') && options.basedir.includes('/packages/')) {
		// Remove .js extension and add .ts for our source files
		if (request.endsWith('.js')) {
			const tsPath = request.slice(0, -3) + '.ts';
			const resolvedTsPath = path.resolve(options.basedir, tsPath);
			// Check if .ts file exists before converting
			if (fs.existsSync(resolvedTsPath)) {
				request = tsPath;
			}
		}
	}

	// Handle zod-to-json-schema internal CJS imports
	if (request.startsWith('./') && options.basedir.includes('zod-to-json-schema/dist/cjs')) {
		const resolvedPath = path.resolve(options.basedir, request);
		if (fs.existsSync(resolvedPath)) {
			return resolvedPath;
		}
	}

	// Call the defaultResolver
	try {
		return options.defaultResolver(request, options);
	} catch (e) {
		// If resolution fails and it's a @babel package, try to resolve from lib instead of src
		if (options.basedir.includes('node_modules/@babel/') && request.startsWith('./')) {
			// Try without .js extension
			if (request.endsWith('.js')) {
				try {
					return options.defaultResolver(request.slice(0, -3), options);
				} catch (e2) {
					// Still failed, rethrow original
					throw e;
				}
			}
		}
		throw e;
	}
};
