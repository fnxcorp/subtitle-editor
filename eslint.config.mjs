// ESLint (flat config) with typescript-eslint. Run: npm run lint
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['build/', 'public/js/', 'node_modules/', 'dist/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/web/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/server/**/*.ts', 'src/desktop/**/*.ts', 'test/**/*.{ts,mts}', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      'no-undef': 'off', // TypeScript already checks this
      '@typescript-eslint/no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }], // storage access may throw (private mode); the app works without it
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
);
