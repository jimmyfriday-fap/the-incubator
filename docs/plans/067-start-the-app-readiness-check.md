# Plan 067: "Start the app" readiness no longer trusts any answer on the address

## Executor preamble

Follows plan 066. The address check before a start stays loose (anything answering means taken, so a 404 from
another program is caught). The readiness check after the steps used the same loose ping, so a different program
that began listening mid-start made the start report success. Readiness now also asks `docker compose ps` whether
the project's own containers are running; an answer counts unless that says none are. When Docker cannot be asked
the answer counts as before, and the loose ping itself is unchanged (an app whose root returns 404 still starts).

## Touched files and markers

| File                              | Marker                                       |
| --------------------------------- | -------------------------------------------- |
| packages/core/src/app-run.ts      | `export async function projectContainersUp(` |
| packages/core/src/engine.ts       | `projectContainersUp(exec, dir, signal)`     |
| packages/core/src/app-run.test.ts | `readiness check (plan 067)`                 |

## Acceptance commands

```bash
pnpm exec vitest run --project unit packages/core/src/app-run.test.ts
node scripts/check.mjs quick
```

```text
Tests  all passed
exit 0
```

## Drift and hallucination guardrails

| Trap                                            | Why                                                   | Mechanical check                                      |
| ----------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| Tightening the ping breaks apps that answer 404 | Many roots return 404 yet are up                      | app-run.test.ts "keeps the loose address check"       |
| No Docker blocks every start                    | A failed or missing `docker` would read as "not mine" | app-run.test.ts "cannot tell" returns null and counts |
| Another program's answer reads as up            | It started listening after the address check          | app-run.test.ts "does not count an answer while"      |

## Review rounds

| Round | Reviewer            | Finding                                   | Status |
| ----- | ------------------- | ----------------------------------------- | ------ |
| 1     | Claude (in-session) | Plan written and reviewed before dispatch | CLOSED |
