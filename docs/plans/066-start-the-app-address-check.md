# Plan 066: "Start the app" refuses a taken address, and its link opens from the desktop app

## Executor preamble

Follows plan 064. Before any step, a start checks whether something already answers on the project's address;
if so it fails with one step, "Check the address is free", instead of running the steps and mistaking the other
program for the project (the readiness check counts any status below 500 as up). A project that is already up
is not checked. In the desktop app the "Open" link to the project's loopback address now opens the user's
browser; in-window navigation stays locked to the app's own origin.

## Touched files and markers

| File                              | Marker                                             |
| --------------------------------- | -------------------------------------------------- |
| packages/core/src/app-run.ts      | `export async function addressInUse(`              |
| packages/core/src/engine.ts       | `await addressInUse(url, this.deps.handoff?.ping)` |
| packages/core/src/app-run.test.ts | `address check (plan 066)`                         |
| apps/desktop/src/window.ts        | `export function localAppAllowed(`                 |
| apps/desktop/src/main.ts          | `localAppAllowed(url)`                             |
| apps/desktop/src/window.test.ts   | `local address externally (plan 066)`              |

## Acceptance commands

```bash
pnpm exec vitest run --project unit packages/core/src/app-run.test.ts apps/desktop/src/window.test.ts
pnpm check:quick
```

```text
Tests  all passed
exit 0
```

## Drift and hallucination guardrails

| Trap                                        | Why                                                     | Mechanical check                                                |
| ------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| Another program's 404 reads as "up"         | Docker Desktop lets two containers bind the same port   | app-run.test.ts "fails with one plain step"                     |
| A thrown ping blocks every start            | A refused connection rejects instead of returning false | app-run.test.ts "when the ping throws"                          |
| Any http link opens from the desktop window | Widening `externalAllowed` would drop the https rule    | window.test.ts `externalAllowed('http://localhost:8080')` false |
| A look-alike host passes as loopback        | `localhost.evil.example` starts with `localhost`        | window.test.ts `localhost.evil.example` false                   |

## Review rounds

| Round | Reviewer            | Finding                                   | Status |
| ----- | ------------------- | ----------------------------------------- | ------ |
| 1     | Claude (in-session) | Plan written and reviewed before dispatch | CLOSED |
