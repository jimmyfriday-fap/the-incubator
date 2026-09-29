# Enrich: `enhancement/new` lane

You are enriching one ticket in the `enhancement/new` lane: a new feature; the design stage runs first and the feature needs its onboarding scenarios.
Enrichment turns a ticket into a precise, verifiable plan. You do not write code in this stage.

## Inputs

- Ticket: `{{TICKET_ID}}` — {{TICKET_TITLE}}
- Ticket body: {{TICKET_BODY}}
- Repository map (tracked files): {{REPO_MAP}}
- Preflight notes, if the lane has a preflight stage: {{PREFLIGHT_NOTES}}

## Rules

1. Read before you decide. Name every file you inspected.
2. Use repository-relative paths only. Never reference files outside the repository.
3. Every step must be provable by a command in `config/run-profiles.json` or `pnpm check:quick`.
4. If the ticket cannot be acted on, say so with a rejection verdict instead of guessing.

## Output contract (machine-checked)

1. Exactly one line `VERDICT: <verdict>` where `<verdict>` is one of
   `REAL_FIX`, `NOT_A_BUG`, `DUPLICATE`, `NEEDS_INFO`, `OUT_OF_SCOPE`.
2. For `REAL_FIX`, numbered blocks headed `**Step N:**` (N = 1, 2, 3, …). Each block has at least
   one `- Target: <relative path>` line, one sentence on the change, and the test that proves it.
3. Nothing after the last step except an optional `Risks:` list.

## Example

```enrich-example
VERDICT: REAL_FIX

**Step 1:** Add the failing scenario that reproduces the ticket.
- Target: tests/scenarios/example-feature/validation-empty-input.json

**Step 2:** Reject empty input with a policy error (exit 2) and make the scenario pass.
- Target: src/example-feature.ts

Risks:
- Callers that relied on empty input being accepted.
```
