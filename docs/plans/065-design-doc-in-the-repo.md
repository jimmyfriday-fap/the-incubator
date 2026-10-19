# Plan 065: the design and the stand-up steps are committed with the project

## Executor preamble

Written and applied in one session (not dispatched). At COMMIT, next to `WHAT-NOW.md`, the engine now writes
`docs/DESIGN.md` (the plain-English idea word for word as a quote, the people, the features, the stack) and
`docs/STAND-UP.md` (the stand-up guide), so the go-forward material lives in the repository and not only in the
run folder.

## Touched files and markers

| File                                 | Marker                                      |
| ------------------------------------ | ------------------------------------------- |
| packages/core/src/design-doc.ts      | `Plan 065`                                  |
| packages/core/src/engine.ts          | `writeFileSync(path.join(dir, DESIGN_FILE)` |
| packages/core/src/design-doc.test.ts | `design document (plan 065)`                |

## Acceptance commands

```bash
pnpm exec vitest run --project unit packages/core/src/design-doc.test.ts
pnpm check:quick
```

```text
Tests  2 passed
exit 0
```

## Drift and hallucination guardrails

| Trap                                   | Why                                           | Mechanical check                                        |
| -------------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| The files are written after the commit | They would show as untracked and block resume | folder-runs.test.ts "plan 057" asserts both are in HEAD |
| The narrative is reworded              | The point is the owner's own words            | design-doc.test.ts expects the quote line for line      |

## Review rounds

| Round | Reviewer            | Finding            | Status |
| ----- | ------------------- | ------------------ | ------ |
| 1     | Claude (in-session) | 3 mutations killed | CLOSED |
