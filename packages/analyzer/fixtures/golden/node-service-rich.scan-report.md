Scanned 15 of 16 files; skipped 1 file because 1 binary.

# Repository scan

## Stack

node-web / fastify-react (web, confidence medium): package.json (depends on fastify)

## Entry points

| File | Kind | Note |
| --- | --- | --- |
| Dockerfile | docker | CMD ["node", "src/index.js"] |
| package.json | script | dev: node --watch src/index.js |
| package.json | script | start: node src/index.js |
| package.json | script | test: vitest run |
| src/cli.js | package-bin | bin parcel-desk |
| src/cli.js | conventional | conventional name |
| src/index.js | conventional | conventional name |
| src/index.js | package-main | package.json main |

## Modules

| Module | Files | Languages |
| --- | --- | --- |
| . | 2 | JavaScript |
| src | 2 | JavaScript |
| src/db | 1 | JavaScript |
| src/routes | 2 | JavaScript |
| test | 1 | JavaScript |

## Module dependencies

| From | To | Imports |
| --- | --- | --- |
| src | src/db | 2 |
| src | src/routes | 2 |
| src/routes | src/db | 2 |

## Dependencies

| Manifest | Manager | Runtime | Dev |
| --- | --- | --- | --- |
| package.json | npm | 3 | 3 |

## Public routes

| Method | Path | File | Framework |
| --- | --- | --- | --- |
| GET | /healthz | src/index.js | node |
| GET | /orders | src/routes/orders.js | node |
| PUT | /orders/:id | src/routes/orders.js | node |
| GET | /users | src/routes/users.js | node |
| POST | /users | src/routes/users.js | node |
| DELETE | /users/:id | src/routes/users.js | node |

## Commands

| Name | File | Kind |
| --- | --- | --- |
| migrate | src/cli.js | commander |
| seed | src/cli.js | commander |

## Data model

| Name | File | Kind |
| --- | --- | --- |
| orders | migrations/001_init.sql | sql-table |
| users | migrations/001_init.sql | sql-table |

## Tests

Runners: vitest. Test files: 1; test cases (approximate): 2.
Layout: test.
Coverage signals: vitest.config.js: coverage config.

## CI and deploy

| File | System | Triggers |
| --- | --- | --- |
| .github/workflows/ci.yml | github-actions | pull_request, push, workflow_dispatch |

Deploy class: not detected.

## Conventions

- Lint: eslint
- Format: prettier
- Type checking: tsc (strict)
- Git hooks: none detected
- Source file naming: undetermined

## Inventory

| Language | Files |
| --- | --- |
| JavaScript | 8 |
| JSON | 2 |
| Markdown | 1 |
| SQL | 1 |
| YAML | 1 |

| Top-level directory | Files |
| --- | --- |
| . | 7 |
| src | 5 |
| .github | 1 |
| assets | 1 |
| migrations | 1 |
| test | 1 |

| Largest source files | Characters |
| --- | --- |
| src/routes/users.js | 356 |
| src/cli.js | 334 |
| src/index.js | 323 |
| src/routes/orders.js | 313 |
| src/db/pool.js | 241 |
| test/users.test.js | 195 |
| vitest.config.js | 89 |
| eslint.config.js | 32 |
