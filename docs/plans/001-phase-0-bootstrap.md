# Plan 001: Phase 0 — bootstrap and dogfood

## Executor preamble

Build the monorepo skeleton and make this repository follow the canonical framework it will generate:
lanes, CI, guardrails, agent config and the executor-plan format. Source of truth: `docs/TDD.md` §2,
§3 and §10 (Phase 0 row). Work top to bottom; after each step run `pnpm check:quick`. Do not start
Phase 1 until every acceptance command below prints the expected output and CI is green.

## Touched files and markers

| File or directory                                                                               | Marker / note                                                                          |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `vitest.config.ts`, `eslint.config.js` | workspace + toolchain (ADR-001)                                                        |
| `packages/runtime/src/*`                                                                        | kernel: exit codes, errors, exec, redaction, secrets, JCS (ADR-002, 008, 009)          |
| `packages/*/src/index.ts`, `apps/*/src/*.ts`                                                    | stubs with one real unit test each                                                     |
| `scripts/guard/*.mjs`, `scripts/check.mjs`, `scripts/tools-fetch.mjs`                           | guard toolkit (ADR-013, 019)                                                           |
| `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.cursor/rules/incubator.mdc`      | `agent-instructions` scaffold region, rendered from `.incubator/agent/INSTRUCTIONS.md` |
| `.claude/settings.json`, `scripts/agent/*`                                                      | SessionStart / Stop hooks (ADR-017)                                                    |
| `.incubator/**`, `config/*.json`, `schemas/*.json`, `contracts.lock.json`                       | lanes, agent profile, profiles, pins                                                   |
| `.github/workflows/{ci,security-scan}.yml`, `lefthook.yml`, `security/**`                       | CI shape, hooks, scanners                                                              |

## Acceptance commands

```sh
pnpm install --frozen-lockfile && pnpm check
```

```text
── check full ──
✔ tools-fetch … ✔ audit   (every step "pass")
exit 0
```

```sh
git clone . "$TMP/fresh" && cd "$TMP/fresh" && pnpm install --frozen-lockfile && pnpm check
```

```text
exit 0
```

## Drift and hallucination guardrails

| Trap                              | Why                                  | Mechanical check                                                                 |
| --------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| Editing CLAUDE.md directly        | Four agent files must share one body | `drift` guard compares region hashes                                             |
| Unpinned `uses:`                  | Supply chain                         | `workflow-lint` requires 40-hex SHAs from `packages/templates/actions-lock.json` |
| Spawning with a shell             | Injection, Windows `.cmd` shims      | ESLint `no-restricted-imports` + Semgrep `incubator.no-shell-true`               |
| Zero tests "passing"              | Empty runs look green                | `tests-collected` reads `.reports/unit.json`                                     |
| Absolute machine paths            | Weakness §3.7-1                      | `abs-path` guard in check and pre-commit                                         |
| Claiming CI green without looking | Acceptance must be evidence          | Phase doc records the Actions run URL                                            |

## Review rounds

| Round | Finding                                                                                       | Status |
| ----- | --------------------------------------------------------------------------------------------- | ------ |
| 1     | Local Semgrep rule `no-shell-true` false positive on `shell: false` (caught by rule fixtures) | CLOSED |
| 2     | abs-path guard missed JSON-escaped Windows paths                                              | CLOSED |
