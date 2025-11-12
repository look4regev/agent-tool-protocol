module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
		project: './tsconfig.json',
	},
	plugins: ['@typescript-eslint', 'prettier'],
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
		'plugin:prettier/recommended',
	],
	rules: {
		'prettier/prettier': 'warn',
		'@typescript-eslint/no-explicit-any': 'warn',
		'@typescript-eslint/no-unused-vars': [
			'warn',
			{
				argsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
			},
		],
		'@typescript-eslint/no-empty-function': 'warn',
		'no-console': 'off',
	},
	env: {
		node: true,
		es2022: true,
	},
	ignorePatterns: [
		'dist',
		'node_modules',
		'*.js',
		'*.mjs',
		'*.cjs',
		'coverage',
		'build',
		'.next',
		'__tests__',
		'jest.config.js',
		'jest-resolver.js',
	],
};
