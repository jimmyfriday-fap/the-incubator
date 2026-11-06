---
name: add-an-adr
description: Records a non-obvious decision as an architecture decision record. Use when a change picks between real alternatives or amends an earlier ADR.
---

# Add an ADR

1. Number it: take the highest file number in `docs/adr/` plus one. The file is `docs/adr/NNN-kebab-title.md`.
2. Start with `# ADR-NNN: <title>`, then the Status (`Proposed` or `Accepted`), the Date and the Context doc, then the sections Context, Decision, Alternatives considered and Consequences.
3. Add a row for it to the index table in Appendix A of `docs/TDD.md`.
4. Run `pnpm exec prettier --write` on both files.

Status: stub from bootstrap; confirm with the owner on first real use.
