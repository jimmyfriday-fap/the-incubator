# ADR-002: A `packages/runtime` kernel shared by all adapters

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context
The brief lists `core` as the home of exit codes. But `git`, `llm` and `tracker` also need
subprocess execution, redaction, error types and secrets handling. If they imported `core`, and `core`
imports them, the package graph would have a cycle.

## Decision
Add `packages/runtime`, with no internal dependencies. It contains:
- `errors.ts` and `exit.ts`: `ToolError`, `PolicyError`, `ParkError`, `InterruptedError` and the
  exit-code map;
- `exec.ts`: the only `child_process` user (ADR-008);
- `log.ts` and `redact.ts`: a structured JSONL logger with the Redactor at the sink (ADR-009);
- `secret.ts` and `keychain.ts`: `SecretString` and the keychain interface plus the
  `@napi-rs/keyring` implementation;
- `paths.ts`: `incubatorHome()`, `resolveInside()`;
- `jcs.ts` and `hash.ts`: RFC 8785 canonical JSON and SHA-256 helpers.

`core` re-exports the exit codes, so the brief's contract ("exit codes in core") still holds for
consumers.

## Consequences
- The dependency graph is a DAG, enforced by `scripts/guard/deps-boundary.mjs`.
- Security-critical primitives (exec, redaction, secrets) live in one small, heavily tested package.

## Alternatives considered
- **Duplicate helpers per package.** Rejected: redaction must be centralized to be trustworthy.
