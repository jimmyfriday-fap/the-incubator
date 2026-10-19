# Plan 064: start a finished project from its run page

## Executor preamble

Written and applied in one session (not dispatched), with its tests and mutation checks. A finished run with a
project folder gets "Start the app": the stand-up steps run in order through PowerShell, each is journaled
(`app.begin`, `app.step`, `app.started`, `app.failed`, `app.stopped`), the run stops at the first failed step,
and the page shows the address once it answers. Stop runs `docker compose down`. No project check runs.

## Touched files and markers

| File                               | Marker                          |
| ---------------------------------- | ------------------------------- |
| packages/core/src/app-run.ts       | `Plan 064`                      |
| packages/core/src/engine.ts        | `async startApp(runId: string)` |
| packages/core/src/live.ts          | `ping: async (url)`             |
| apps/web/src/server/server.ts      | `/api/runs/:id/app/start`       |
| apps/web/src/ui/views/StartApp.tsx | `StartAppPanel`                 |
| packages/core/src/app-run.test.ts  | `start the app (plan 064)`      |

## Acceptance commands

```bash
pnpm exec vitest run --project unit packages/core/src/app-run.test.ts
pnpm check:quick
```

```text
Tests  6 passed
exit 0
```

## Drift and hallucination guardrails

| Trap                                  | Why                                           | Mechanical check                                     |
| ------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| A failed step is ignored              | The page would say "up" over a broken project | app-run.test.ts "stops at the first step that fails" |
| The project's own check runs on start | It is red on some projects and slow           | app-run.test.ts "leaves the project check out"       |
| Wrong port for a stack                | The Open link would point nowhere             | app-run.test.ts "knows where each stack answers"     |

## Review rounds

| Round | Reviewer            | Finding                                                          | Status |
| ----- | ------------------- | ---------------------------------------------------------------- | ------ |
| 1     | Claude (in-session) | 5 mutations killed; unfinished run refused (folder-runs.test.ts) | CLOSED |
