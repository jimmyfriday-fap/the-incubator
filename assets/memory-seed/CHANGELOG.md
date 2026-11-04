# Changelog

## 1.0.1

- **Isolation terms are code identifiers, not names.** The `ISOLATION.txt` guidance now says to list another system's distinctive identifiers (function prefixes, plugin slugs, internal endpoints), never shared brand names, domains, or hosts. Preflight drops any term found in the target repos' own files and reports where it appears. Fixes the case where a repo hosted on another system's domain failed its own isolation check.
- **Commit policy follows the repo.** New `memory.conf` with `commit_policy=pr|direct`, detected from AGENTS.md, CLAUDE.md, CONTRIBUTING.md, or git history. With `direct`, the pre-commit main guard is off, and PERMISSIONS.md swaps "branch + PR" for "only when the human asked". The dream pass writes a report without editing context.
- **AGENTS.md is respected.** It is never edited. Bootstrap reads it as a source but doesn't duplicate its rules into memory. When CLAUDE.md is just `@AGENTS.md`, the memory block is added below the import.

## 1.0.0

- Initial seed: repo mode and store mode, `bin/memory`, pre-commit and session-end hooks, write-memory / dream / memory-bootstrap skills, and two deploy playbooks.
