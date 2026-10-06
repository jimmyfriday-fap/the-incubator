# Plan 019: stop the work under way, and cancel a run

## Executor preamble

Delivers the stop and cancel parts of ADR-029. It changes no contract, spec schema or pack.

Nothing could stop an analysis, a model call or the coding agent once it had started, and closing the app left
the journal without an entry and the agent's process running.

1. **Signal.** `CompleteRequest.signal`; the CLI adapter passes it to `Exec.run` (which kills the process tree
   and reports `aborted`), the API adapter passes it to the request; an abort raises `InterruptedError`, which
   `complete()` never wraps or retries. `runProcess` refuses to start when the signal has already fired.
2. **Engine.** One `AbortController` per `advance`; `abortRun(runId, by)`, `abortAll(by)`, `activeRuns()`;
   `throwIfStopped` at the top of every step; the signal reaches the draft turn, the analysis summary, the
   review summary (its own controller) and `launchHandoff`. `launchHandoff` outside `advance` (the command
   line) registers its own controller so Ctrl+C reaches it. A second `advance` on a working run is refused.
3. **Journal.** `interrupted {by, state}` and `run.cancel {reason?}`; `RunState.stopped` and `cancelled`;
   `Engine.cancel` refuses a working or finished run; a cancelled run is done and cannot be resumed.
4. **Coding.** `HandoffOutcome.stopped`; verdict `stopped`; the run reaches the commit request after a stop.
5. **Driver and server.** `RunDriver.stop`, `cancel`, `stopAll`; `POST /api/runs/:id/stop` and `/cancel`;
   closing the server stops what is running (`by: shutdown`).
6. **UI.** Stop while working, Cancel run with a confirmation, a "You stopped this at …" panel, a CANCELLED
   badge and a Cancelled filter on Runs.
7. **Command line.** The launcher stops the current run on the first Ctrl+C and exits 130 on a second or when
   nothing is running; `incubator handoff --launch` reports a stopped agent and exits 130.

## Touched files and markers

| File or directory                                                                       | Marker / note                                                                            |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/runtime/src/exec.ts`, `exec.test.ts`                                          | `ExecResult.aborted`, a signal that has already fired refuses to start                   |
| `packages/llm/src/types.ts`, `gate.ts`, `cli-adapter.ts`, `anthropic.ts`, `llm.test.ts` | `CompleteRequest.signal`, no retry or wrap of a stop                                     |
| `packages/core/src/engine.ts`, `state.ts`, `handoff.ts`, `finish.ts`, `stop.test.ts`    | `abortRun`, `abortAll`, `cancel`, `RunState.stopped/cancelled`, `HandoffOutcome.stopped` |
| `packages/core/fixtures/handoff/fake-agent.mjs`                                         | `FAKE_AGENT_MODE=slow`                                                                   |
| `apps/web/src/server/driver.ts`, `server.ts`, `server.test.ts`                          | `stop`, `cancel`, `stopAll`, `/api/runs/:id/stop`, `/cancel`, `onClose`                  |
| `apps/web/src/ui/views/RunView.tsx`, `Runs.tsx`, `FinishChanges.tsx`, `styles.css`      | Stop, Cancel run, the stopped panel, CANCELLED                                           |
| `apps/cli/bin/incubator.mjs`, `apps/cli/src/main.ts`, `commands/handoff.ts`             | `InterruptControl`, the SIGINT handler                                                   |
| `docs/adr/029-stop-cancel-and-settings.md`, `docs/TDD.md`                               | the decision; the exit-code row for 130                                                  |

## Acceptance commands

```sh
export PATH="/c/tools/node22:$PATH"
pnpm exec vitest run packages/runtime packages/llm packages/core/src/stop.test.ts packages/core/src/handoff.test.ts apps/web apps/cli
INCUBATOR_E2E_CHANNEL=chrome pnpm test:e2e
pnpm check:quick
INCUBATOR_E2E_CHANNEL=chrome pnpm check
```

```text
stopping a model call rejects with InterruptedError, is not retried or wrapped, and the run resumes at the same step
stopping the coding agent kills its process tree, keeps what it wrote, reaches the commit request with verdict stopped
a cancelled run is done, cannot be resumed or cancelled again, and its files are untouched
closing the server stops every working run and the journal says shutdown
the first Ctrl+C stops the run and exits 130; nothing running exits at once
pnpm check exits 0
```

## Drift and hallucination guardrails

| Trap                                         | Why                                                   | Mechanical check                                                           |
| -------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| A stop is recorded as a failure              | the owner asked for it; Resume must not show an error | the server test: `error` is null and `stopped` names the owner             |
| An aborted model call is retried             | one stop must end the call                            | `llm.test.ts`: the adapter is called once, and not again after the stop    |
| Cancel deletes or resets the owner's files   | the agent's partial work is the owner's to judge      | the server test: the half-written file is still there after cancel         |
| A cancelled run is resumed or advanced       | it is done for good                                   | `stop.test.ts`: `resume` and `advance` change nothing; the API answers 409 |
| A stop is swallowed by an advisory step      | the run would carry on after the owner said stop      | the analysis and review-summary catches rethrow `InterruptedError`         |
| Closing the app leaves the agent running     | a process nobody can see                              | the server test closes the server mid-coding and checks `by: shutdown`     |
| Ctrl+C exits `ui` without closing its server | its own handler closes the server gracefully          | `main` sets no stop control for `ui`; the CLI test                         |

## Review rounds

| Round | Finding                                                                                                                                         | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Nothing could stop a model call, the coding agent or the review summary, and a close left child processes behind; all are stopped and journaled | CLOSED |
| 2     | The scan is synchronous, so a stop during it takes effect at the next step; the page says "Stopping…" until the run is idle                     | CLOSED |
