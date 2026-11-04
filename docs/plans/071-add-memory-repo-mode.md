# Plan 071: Add memory to a solution (repo mode)

## Executor preamble

"Add memory" (docs/incubator-memory-feature.md, ADR-031, TDD §7.7) installs agent memory into one solution by
running the memory seed's playbook in a coding-agent session. The seed (`assets/memory-seed/`) is read-only:
each run copies it and hands the agent only the copy. The agent commits; it never pushes, runs `gh` or reaches
the network. The Incubator checks the install after the agent stops and parks on a broken rule
(`memory_rules_broken`) or a failed verification (`memory_verify_failed`); the owner decides the push. Repo
mode only: store mode, Add member, Upgrade and Dream are deferred. Never edit the seed, never weaken a check
to get a run through, and keep `MEMORY_ALLOWED_TOOLS` free of any push, `gh` or network command.

## Touched files and markers

| File                                  | Marker                                       |
| ------------------------------------- | -------------------------------------------- |
| packages/core/src/memory.ts           | `export const MEMORY_ALLOWED_TOOLS`          |
| packages/core/prompts/memory-repo.md  | `name: memory-repo`                          |
| packages/core/src/engine.ts           | `private async memoryRunStep(`               |
| packages/core/src/handoff.ts          | `extra: { addDirs?: readonly string[]`       |
| packages/llm/src/probe.ts             | `set('addDir', pickFlag(`                    |
| apps/web/src/server/server.ts         | `'/api/memory/defaults'`                     |
| apps/web/src/ui/views/AddMemory.tsx   | `data-testid="memory-form"`                  |
| apps/cli/src/commands/memory.ts       | `export async function runMemory(`           |
| apps/desktop/scripts/build.mjs        | `copy('assets/memory-seed', 'memory-seed');` |
| docs/adr/031-add-memory-runs.md       | `# ADR-031:`                                 |
| packages/core/src/memory-runs.test.ts | `describe('Add memory runs (plan 071)'`      |

## Acceptance commands

```bash
pnpm exec vitest run --project unit packages/core/src/memory.test.ts packages/core/src/memory-runs.test.ts
pnpm check:quick
```

```text
Tests  all passed
exit 0
```

## Drift and hallucination guardrails

| Trap                                                | Why                                                                | Mechanical check                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| A push or `gh` command slips into the allowed tools | The playbook itself says to push and open a PR                     | memory.test.ts "never allows a push, gh or the network"                  |
| An install that edits AGENTS.md is accepted         | The check list is long and easy to shorten                         | memory-runs.test.ts "parks memory_rules_broken when AGENTS.md changed"   |
| The desktop app reads the seed from inside the asar | electron-builder packs everything under app/ unless told otherwise | `asarUnpack` lists `memory-seed/**` in apps/desktop/electron-builder.yml |
| A failed playbook verification is pushed anyway     | The report is free text read by a regex                            | memory-runs.test.ts "parks memory_verify_failed"                         |

## Review rounds

| Round | Reviewer            | Finding                                   | Status |
| ----- | ------------------- | ----------------------------------------- | ------ |
| 1     | Claude (in-session) | Plan written and reviewed before dispatch | CLOSED |
