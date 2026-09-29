import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'coverage/**',
      '.reports/**',
      '.tools/**',
      'apps/desktop/release/**',
      'apps/desktop/release-test/**',
      'apps/desktop/app/**',
      'apps/desktop/app-test/**',
      'packages/templates/packs/**/files/**',
      'packages/analyzer/fixtures/**',
      'security/fixtures/**',
      '**/__golden__/**',
      // Generated from JSON Schema and drift-tested (packages/spec/src/spec.test.ts).
      '**/*.gen.ts',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['**/*.mjs', '**/*.js', '**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // why: exec.ts is the single audited place that spawns processes (shell:false, ADR-008).
    files: ['packages/**/*.ts', 'apps/**/*.ts'],
    ignores: ['packages/runtime/src/exec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'child_process', message: 'Use Exec from @incubator/runtime (ADR-008).' },
            { name: 'node:child_process', message: 'Use Exec from @incubator/runtime (ADR-008).' },
          ],
        },
      ],
    },
  },
  {
    // why: only launchers map results to process exit codes (exit-code contract, TDD §1).
    files: ['packages/**/*.ts', 'apps/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'exit',
          message: 'Return an exit code; only bin/ launchers exit.',
        },
      ],
    },
  },
);
