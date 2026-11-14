# Changelog

## 1.1.0

- **Session transcripts are redacted before they are copied.** `hooks/session-end` no longer `cp`s the raw transcript (tool output, so secrets, IP addresses and emails) into the store: it runs the new `bin/redact-transcript.mjs`, which replaces them with `[REDACTED:<rule>]`. With no `node` or no redactor it copies nothing and says so on stderr, never a raw copy. Install `bin/redact-transcript.mjs` wherever `bin/memory` goes (`.memory/bin/` in repo mode, the store's `bin/` in store mode); the member hook reads it from the store. Upgrade existing installs by copying `bin/` and `hooks/`, and each member's `.claude/hooks/memory-session-end`.
- **Sessions started in a git worktree are captured.** The hook resolves the main checkout (via the git common dir) for the `.memory-link` file, the store path and the repo name. Before this, a worktree session found no untracked `.memory-link` or a relative store path that did not resolve, and about half the transcripts were never copied.
- **Windows.** The hook drops the carriage return that Windows Python appends to `session_id` and `transcript_path`, and strips trailing whitespace from `.memory-link` values.

## 1.0.1

- **Isolation terms are code identifiers, not names.** The `ISOLATION.txt` guidance now says to list another system's distinctive identifiers (function prefixes, plugin slugs, internal endpoints), never shared brand names, domains, or hosts. Preflight drops any term found in the target repos' own files and reports where it appears. Fixes the case where a repo hosted on another system's domain failed its own isolation check.
- **Commit policy follows the repo.** New `memory.conf` with `commit_policy=pr|direct`, detected from AGENTS.md, CLAUDE.md, CONTRIBUTING.md, or git history. With `direct`, the pre-commit main guard is off, and PERMISSIONS.md swaps "branch + PR" for "only when the human asked". The dream pass writes a report without editing context.
- **AGENTS.md is respected.** It is never edited. Bootstrap reads it as a source but doesn't duplicate its rules into memory. When CLAUDE.md is just `@AGENTS.md`, the memory block is added below the import.

## 1.0.0

- Initial seed: repo mode and store mode, `bin/memory`, pre-commit and session-end hooks, write-memory / dream / memory-bootstrap skills, and two deploy playbooks.
