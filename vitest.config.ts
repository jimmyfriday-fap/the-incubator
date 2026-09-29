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
          // why: git-heavy integration tests spawn dozens of processes; Windows runners spawn them
          // several times slower (8-18 s per test observed), so 30 s left no headroom there.
          testTimeout: process.platform === 'win32' ? 120_000 : 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          // Playwright against the built UI and the server on fakes (`pnpm test:e2e`, check full).
          include: ['apps/*/e2e/**/*.e2e.test.ts'],
          setupFiles: ['tests/setup/no-network.ts'],
          testTimeout: 120_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'desktop-smoke',
          // Electron launched through Playwright (desktop.yml; locally under xvfb-run on Linux).
          include: ['apps/desktop/smoke/**/*.smoke.test.ts'],
          setupFiles: ['tests/setup/no-network.ts'],
          testTimeout: 180_000,
          hookTimeout: 60_000,
          fileParallelism: false,
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
