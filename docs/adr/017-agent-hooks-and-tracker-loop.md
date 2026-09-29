# ADR-017: Agent hooks: a Stop-hook veto as the verification loop

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context

The brief requires: SessionStart installs dependencies and runs `check:quick`; Stop signals
READY_FOR_TEST; and the verification-loop rule "after every change, run the check; veto the change if
it fails; log the failure through the tracker". Claude Code's Stop hook can block stopping by exiting
2 and returning feedback on stderr. The hook input includes `stop_hook_active`.

## Decision

- **`SessionStart`** runs `node scripts/agent/session-start.mjs`: detect the package manager, install
  with the frozen lockfile, run `check:quick`, and print a summary. It always exits 0, so it never
  blocks a session. Failures are reported in the summary.
- **`Stop`** runs `node scripts/agent/on-stop.mjs`, which runs `check:quick`:
  - **pass:** transition the active ticket (`.incubator/state/active-ticket`) to `READY_FOR_TEST` via
    the tracker client, then exit 0;
  - **fail:** file a remediation item with the failing command and a log excerpt, increment
    `.incubator/state/stop-vetoes.json`, print the failure to stderr and **exit 2** (the veto);
  - **More than 3 consecutive vetoes:** exit 0, but transition the ticket to parked with evidence.
    This prevents infinite loops within the run ceilings. `stop_hook_active` is recorded but the
    counter decides: honouring it would allow only a single veto.
- The instructions files state the same rule for agents without hooks (Copilot, Cursor). Their
  compliance is enforced by the pre-push `check:quick` and CI.
- The tracker client in generated repos is a small Node module
  (`scripts/agent/tracker.mjs`: local or Leantime), sharing its wire format with `packages/tracker`.

## Consequences

- "Veto" is mechanical for Claude, and best-effort for other agents, backed by git hooks and CI.

## Alternatives considered

- **PostToolUse on every Edit.** Rejected: it runs `check:quick` dozens of times per session, which is
  too slow.
