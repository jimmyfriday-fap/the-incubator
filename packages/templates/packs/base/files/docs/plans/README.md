# Executor plans

Plans are numbered `NNN-kebab-slug.md` and follow the executor-plan format checked by
`scripts/guard/plan-lint.mjs`: executor preamble, touched files and markers, acceptance commands with
expected output, drift and hallucination guardrails (Trap | Why | Mechanical check), and review rounds
(FIX-FIRST / CLOSED). Plans never live at the repository root.
