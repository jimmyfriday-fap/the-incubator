# ADR-010: An append-only JSONL journal with a pure reducer for resume

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context

Any state may park, parked runs must resume (brief §5), and `publish --resume` must continue after any
failed step (brief §7).

## Decision

- `runs/<runId>/journal.jsonl` is append-only, one event per line: `{seq, ts, type, ...}`. The types
  are:
  - `run.start`;
  - `state.enter`;
  - `decision`;
  - `spec.revision`;
  - `step.start`, `step.ok`, `step.warn`, `step.fail`;
  - `park`;
  - `nudge`;
  - `interrupted`;
  - `run.done`.
- Each write is `appendFile` followed by `fsync` of the file descriptor. A torn last line (a crash
  mid-write) is detected on read and truncated, with a `journal.repaired` warning.
- A pure `reduce(events) → RunState` rebuilds state, and resume re-enters the recorded state.
- Effectful steps are **check-then-act**. Each has a `resumeCheck` that inspects the real world
  (GitHub or git), so a crash between the effect and `step.ok` doesn't duplicate effects.
- Timestamps appear only in the journal and logs, never in rendered files.

## Consequences

- Fault-injection tests can crash "after effect, before journal" and prove idempotency.
- The journal doubles as the audit log shown in the UI's run log.

## Alternatives considered

- **SQLite.** Rejected: a native dependency for no benefit at this scale, and a harder-to-inspect
  audit trail.
