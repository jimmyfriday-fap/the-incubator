import { defineConfig } from 'vitest/config';

// why: resolve sibling workspace packages to their TypeScript sources so tests need no build step.
const conditions = ['@incubator/source', 'module', 'node', 'development|production'];
const live = process.env['INCUBATOR_LIVE'] === '1';

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    reporters: ['default', 'json'],
    outputFile: { json: '.reports/unit.json' },
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.live.test.ts',
        '**/index.ts',
        '**/testing-fixtures/**',
        'apps/web/src/ui/**',
        'apps/desktop/src/main.ts',
        'apps/cli/src/wiring.ts',
      ],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: '.reports/coverage',
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/*/src/**/*.test.ts',
            'scripts/**/*.test.mjs',
            'tests/**/*.test.ts',
          ],
          exclude: ['**/*.live.test.ts', '**/node_modules/**', '**/dist/**', 'apps/web/e2e/**'],
          setupFiles: ['tests/setup/no-network.ts'],
          testTimeout: 30_000,
        },
      },
      ...(live
        ? [
            {
              extends: true as const,
              test: {
                name: 'live',
                include: ['packages/*/src/**/*.live.test.ts', 'apps/*/src/**/*.live.test.ts'],
                testTimeout: 300_000,
              },
            },
          ]
        : []),
    ],
  },
});
