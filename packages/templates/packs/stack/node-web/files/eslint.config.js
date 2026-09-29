import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', '.reports/**', '.tools/**', 'security/fixtures/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { project: ['./tsconfig.json', './tsconfig.web.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.mjs', '**/*.js', '**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/web/**/*.tsx', 'src/web/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
