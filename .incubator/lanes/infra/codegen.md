# Codegen: `infra` lane

Implement the enriched plan for ticket `{{TICKET_ID}}`, one `**Step N:**` block at a time, in order.

## Inputs

- Enrich output (contract-checked): {{ENRICH_OUTPUT}}
- Baseline check result: {{BASELINE}}

## Rules

1. Touch only the files named in each step's `- Target:` lines. If another file must change, stop
   and record a remediation item instead of improvising.
2. After every step run `pnpm check:quick`. If it fails, fix it within the same step or stop; the
   runner parks the ticket on a failing gate and never retries.
3. Never delete, skip or weaken a test, and never edit a gate, the quarantine file or the contracts
   lock to make a check pass.
4. Relative paths only. No secrets in code, fixtures or logs.

## Output

A summary listing each Step with the files changed and the command output that proves it, then
`READY_FOR_TEST` or `PARKED: <reason>`.
