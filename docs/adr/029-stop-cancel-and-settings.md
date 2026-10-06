# ADR-029: Stop and cancel a run, settings the owner can change, and which model did each job

- **Status:** Proposed
- **Date:** 2026-10-06
- **Context doc:** [`docs/TDD.md`](../TDD.md) §2.5, §7.5, §9; amends
  [ADR-010](010-run-journal-and-resume.md) and [ADR-023](023-local-folder-workflow.md)

## Context

The owner's first real update run showed three gaps. Nothing could stop an analysis, a model call or the
coding agent once it had started; the only way out was to close the app, which left the journal without an
entry and the agent's process running. There was no way to say which AI did the planning or the coding, or to
choose its model: `config.json` held the settings but nothing wrote it, the coding agent was never given a
model, and the interface showed no adapter or model anywhere. And the app had no way to move around.

## Decision

1. **One stop signal per working run.** The engine keeps an `AbortController` for the work an `advance` has
   under way, and threads its signal to the calls that can be cancelled: the model call (`CompleteRequest.signal`;
   the CLI adapter kills the process tree, the API adapter cancels the request) and the coding agent
   (`launchHandoff`, merged with its own ceiling controller). Between steps the loop checks it. A scan is
   synchronous and ends at its next step. An abort raises `InterruptedError`, which the schema gate never wraps
   or retries.
2. **Two actions.** _Stop_ ends the work now and leaves the run resumable. _Cancel_ abandons the run for good.
3. **Journal.** `interrupted {by: owner | signal | shutdown, state}` says who stopped it and where; the reducer
   keeps it as `RunState.stopped` until the run moves again. `run.cancel {reason?}` makes the run done and
   `cancelled`; it cannot be resumed or advanced. `incubator gc` removes a cancelled run like a finished one.
   The portfolio shows `STOPPED` and `CANCELLED`.
4. **A stopped coding agent is not a failure.** The outcome carries `stopped`, the verdict is `stopped`, and the
   run reaches the commit request as it does after a ceiling trip; the owner commits, leaves or cancels. This
   implements ADR-023's `coding_interrupted`. Cancel never touches the owner's files.
5. **Closing the app and Ctrl+C stop the work.** The server stops every working run before it closes
   (`by: shutdown`); the command line stops the current run on the first Ctrl+C (journaled, exit 130) and exits
   at once on a second or when nothing is running. `incubator ui` keeps its own graceful shutdown.
6. **Settings are written from the app and the command line.** `ConfigStore` reads `config.json` on every use,
   so a change applies to the next run, and writes it atomically with mode 0600, keeping keys it does not know.
   One validator (`applySettings`) serves both surfaces: the planning tool and model, the coding agent and
   model, the model timeout, the `gc` age and the tool locations. A model id is a plain token (letters, digits
   and `. _ : -`) because it reaches a command line (T6). Secrets are never read or written through this
   interface: accounts are shown as a source only, and `incubator auth set` stays the way in.
7. **A chosen coding model is honoured or the run says why not.** The model is passed with the CLI's own model
   flag. A CLI with no such flag parks the run `model_unsupported`; the choice is never silently ignored.
8. **Which model did each job.** The coding agent's `system`/`init` event names its model; the CLI adapter reads
   the models Claude reports in `modelUsage`. The journal carries them, and a run lists the tool and model for
   its questions, analysis, review summary and coding.

## Alternatives considered

- **Kill the whole process on stop.** Simple, but it takes the app down with it and loses the journal entry.
- **Cancel only, no stop.** A stop that can be resumed is what the owner asks for when an analysis runs long.
- **Let Settings write secrets.** A secret in an HTTP body breaks the rule that secrets come from the keychain,
  a hidden prompt or the environment.
- **Read the config once at start.** A saved change would need a restart; the owner asked for settings that
  apply to the next run.

## Consequences

- A stop during the scan waits for the scan to end; the page says "Stopping…" until the run is idle.
- Advisory calls (the analysis summary, the review summary) rethrow a stop instead of recording a warning, so a
  stop is never mistaken for a failed summary.
- The journal's list of entry types in ADR-010 gains `interrupted` (with `by` and `state`) and `run.cancel`.
- Which model a CLI tool used is only as good as what the tool reports; an unreported model shows as the tool's
  default.
