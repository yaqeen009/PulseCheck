// PulseCheck ESLint configuration (flat config).
//
// Deliberately type-unaware: `tsc --noEmit` already performs the type checking
// in every package (`npm run typecheck`), so ESLint stays fast and only enforces
// correctness-adjacent rules and style consistency.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'packages/server/src/generated/**',
      '.pgdata*',

      // Build output of the web app
      'packages/web/dist/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Underscore-prefixed identifiers are intentionally unused (Express
      // middleware signatures and ignored request objects).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // `any` defeats the point of a strict TypeScript project.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    // Scripts, seeds and tests legitimately use console output.
    files: [
      '**/scripts/**/*.ts',
      '**/prisma/**/*.ts',
      '**/monitoring/run-once.ts',
      '**/test/**/*.ts',
      '**/*.test.{ts,tsx}',
      '**/e2e/**/*.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },

  {
    // Config files are executed by Node/ESLint tooling.
    files: ['*.{js,mjs,cjs}', '**/*.config.{js,mjs,cjs,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Must stay last: disables rules that would fight Prettier.
  prettier,
);
