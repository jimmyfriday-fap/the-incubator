# ADR-021: Deep scan: deterministic, capped, and honest about what it skipped

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context doc:** [`docs/TDD.md`](../TDD.md) §7.4

## Context

Enhancement needs the whole repo understood (stack, entry points, modules, routes, data model, tests,
CI, conventions), not only canonical gaps. The repo is untrusted input (threat T6), may be huge, and
the owner must be able to tell what the scan did not see.

## Decision

- `deepScan(view)` is pure and deterministic: manifest parsing and regexes, no LLM, no execution of
  repository code. Same tree in, byte-identical report out.
- `RepoView` stays read-only and keeps its caps (5,000 listed files, 1 MiB per read). It gains
  `stats()`: total seen, listed, and skipped counts by reason (`ignored-dir`, `over-file-cap`,
  `binary`, `over-byte-cap`, `symlink`, `walk-cap`), with a few examples each. Counting stops at a
  hard 50,000 entries and the total is then reported as "at least".
- Every report starts with "Scanned N of M files; skipped X because Y", and every derived list
  (edges, routes, models, inventory) has its own cap with a "truncated" note.
- The LLM summary (`analysis-summary.md`) is a separate, later step on top of the scan digest: tools
  disabled, empty cwd, content on stdin (ADR-007), output labelled machine-generated.

## Consequences

- Heuristic detectors will miss frameworks they do not know; the report says "not detected", never
  guesses.
- Golden fixtures pin the output, so a detector change is a visible diff.

## Alternatives considered

- **Let an LLM agent explore the repo with tools.** Rejected: breaks ADR-007 and T6.
- **Raise the file cap.** Rejected: memory risk; visibility of the cap is the requirement.
