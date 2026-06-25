// ESLint flat config for lit-search (ESM, Node.js >= 18)
// We use the recommended rule set, soften a few rules that would otherwise
// generate noise in a CLI / MCP codebase, and add a small number of explicit
// quality rules. The goal is to catch real issues (unused vars, unreachable
// branches, accidental globals) without forcing stylistic churn - Prettier
// owns formatting.

import js from '@eslint/js';
import globals from 'globals';

export default [
  // Apply the project's recommended baseline to every JS file we ship or test.
  js.configs.recommended,

  // Source files: bin/, lib/, tests/
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // CLI and MCP code intentionally use console; do not warn.
      'no-console': 'off',

      // Allow unused args that start with underscore (intentional ignore).
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // The project uses both `== null` and `===`. Keep === by default but
      // allow null comparisons (a common idiom) - `== null` matches both
      // null and undefined which is the intended behavior.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // Prefer const for variables that are never reassigned.
      'prefer-const': 'warn',

      // Make accidental globals a hard error.
      'no-implicit-globals': 'error',
    },
  },

  // Test files: relax rules that are noisy in test code (long descriptive
  // names, throw assertions, etc.) and ensure Node globals are available.
  {
    files: ['tests/**/*.test.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Tests legitimately create throwaway variables.
      'no-unused-vars': 'off',
    },
  },

  // Files we never want to lint: dependencies, build artifacts, and the
  // dev-only `temp/` directory used for local API key storage.
  {
    ignores: ['node_modules/**', 'coverage/**', 'temp/**', 'package-lock.json', '*.min.js'],
  },
];
