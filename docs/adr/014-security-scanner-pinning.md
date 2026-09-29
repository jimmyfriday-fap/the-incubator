# ADR-014: Scanner pinning, gitleaks binary over the action, stable fingerprints

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context

The brief requires Semgrep, Trivy and gitleaks, SHA-pinned `uses:`, hash-pinned installers, a policy
gate with stable fingerprint IDs, and an accepted-risk register. `gitleaks/gitleaks-action` v2
requires a `GITLEAKS_LICENSE` for organisation-owned repos.

## Decision

- **Semgrep** is installed from hash-locked wheels (`tools/semgrep-requirements.txt`, generated with
  `uv pip compile --universal --generate-hashes`, installed with `pip --require-hashes`) and runs
  `semgrep scan --config p/default --config security/rules --metrics off --json`. The same lock serves
  local `pnpm check` and CI, so there is one pinning mechanism instead of a container digest plus a
  local install. `p/default` is used instead of `auto` because `--config auto` forces metrics on.
- **Trivy** runs through `aquasecurity/trivy-action@<sha>` (`scan-type: fs`, `severity:
HIGH,CRITICAL`, JSON format).
- **gitleaks** is the release tarball, downloaded and verified against a pinned SHA-256, then run with
  `gitleaks git --report-format json`.
- **Fingerprint:** a tool-native stable ID where one exists; otherwise
  `sha256(tool ‖ ruleId ‖ path ‖ collapse_ws(snippet))`.
- **Policy gate:** severity mapping (Semgrep `ERROR`→HIGH, `WARNING`→MEDIUM; gitleaks → HIGH).
  Findings ≥ `security.policyGate` that aren't covered by an unexpired register entry exit 2.
- An inline suppression without a register entry is itself a finding (`incubator.unregistered-suppression`).

## Consequences

- It works for org repos without a licence. Pins are refreshed by a script plus a review.

## Alternatives considered

- **gitleaks-action.** Rejected: licensing for orgs.
