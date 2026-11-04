# Memory store

File-based memory for this system. Agents read `INDEX.md` first, open only what they need, and write durable learnings back under `WRITE-RULES.md`.

- `context/platform/`: applies everywhere. Changes go through a branch and PR.
- `context/projects/<repo>/`: one directory per repo. Attended agents write their own repo's files directly.
- `skills/` (repo mode: `.claude/skills/`): procedures, loaded on demand.
- `scratch/`: per-session notes. Not committed.
- `transcripts/`: local session transcripts. Not committed. Input to the dream pass.
- `dreams/`: reports from each dream run, with the evidence for each proposed change.

Commands: `bin/memory index` (regenerate INDEX.md), `bin/memory check` (validate), `bin/memory stale` (files not verified in 60 days).

Install the git guardrail on a fresh clone: create `.git/hooks/pre-commit` containing
`exec "$(git rev-parse --show-toplevel)/<store-prefix>hooks/pre-commit"` and make it executable.

Built from memory-seed version: see `.seed-version`.
