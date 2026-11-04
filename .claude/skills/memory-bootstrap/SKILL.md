---
name: memory-bootstrap
description: Populates a memory store from the codebase of one or more member repos, then reconciles shared knowledge into the platform tier. Run at install, when adding a member, or after a major restructure. Produces a PR, never a direct commit.
---

# Memory bootstrap

Record what you observe. Label what you infer. Cite everything. Follow `WRITE-RULES.md`; actor is `bootstrap`. Never copy secrets, env values, customer or tenant data, or personal data.

**AGENTS.md is canonical for what it already says.** If a member has an `AGENTS.md` (often imported by CLAUDE.md as `@AGENTS.md`), read it as a source, but don't copy its rules into memory: sessions already load it. Record only what it doesn't cover, and never edit it.

Inputs: the store root, and the list of member repos to bootstrap (repo mode: just the one repo; store mode: the `members` in `system.yaml`, or only the newly added member).

## Part 1: per member (repeat for each member M)

You may run members in parallel with subagents. Each subagent writes **only** under `context/projects/M/`.

1. **Survey → `projects/M/overview.md`.** Purpose in one or two lines; languages and frameworks; package manifests; entry points; exact build, run, and test commands; CI; schema or migration files; external services called; existing README, CLAUDE.md, and docs.
2. **Convention candidates → `projects/M/conventions.md`** (temporary; Part 2 empties it). Naming, file layout, data access, error handling, UI and styling constraints, testing patterns. Each needs at least 3 consistent cited examples or one explicit statement in docs; otherwise mark it `(unconfirmed)`.
3. **Decisions → `projects/M/decisions.md`.** Search `git log` messages, CLAUDE.md, README, docs, ADRs, and code comments for "we decided", "always", "never", "don't", "must", "because", "instead of". One line each, with its source. Anything you can't tie to a stated source is `(unconfirmed)`.
4. **Failures → `projects/M/failures.md`.** From `TODO`/`FIXME`/`HACK`/workaround comments and fix-type commits (`fix:`, revert, workaround), record failures likely to recur, with the fix if known. Skip one-off bugs.
5. **Status → `projects/M/status.md`.** Two to five observed lines: notable open branches, in-flight work, known broken or skipped tests.
6. **Cross-repo references.** List every reference M makes to another member (imports, API or MCP calls, shared function or table names, shared config). Hand these to Part 2; don't write them yet.
7. **Procedure stubs → skills.** For each multi-step procedure with evidence (a scaffold script, a release or deploy checklist, a migration routine, a recurring "how to add X"), create `<skills dir>/<kebab-name>/SKILL.md` with frontmatter (`name`, a two-sentence `description` saying when to use it), the steps as far as the evidence supports, and the final line `Status: stub from bootstrap; confirm with the owner on first real use.` At most 5 per member; pick the most frequent. In store mode, prefix member-specific skill names with the repo name.

## Part 2: reconcile (always run, even with one member)

8. **Conventions.** Promote a candidate to `context/platform/conventions.md` if it holds in 2 or more members, or it comes from a member whose role is `platform-source`, or this is repo mode (one member: everything stable is platform). Cite every contributing member: `(src: a:path, b:path)`. Move non-promoted candidates into that member's `overview.md` under a "Local conventions" heading. Then delete every `projects/*/conventions.md`.
9. **Decisions.** A decision that names or affects more than one member moves to `context/platform/decisions.md`. The rest stay in project files.
10. **Architecture → `context/platform/architecture.md`.** Repo mode: the main components and how they connect, from the overview. Store mode: a system map with one line per member giving its role, plus one line per cross-repo edge from step 6 (`a calls b via <mechanism> (src: a:path)`).
11. **Platform failures.** A failure pattern present in 2 or more members' `failures.md` gets one line in `context/platform/failures.md`. Keep the project lines.
12. **Tenancy check.** If any member shows multi-tenant patterns (tenant or group ids on tables, per-tenant databases, tenant-scoped config), add to `PERMISSIONS.md`: "Tenant-scoped learnings live in the application's tenant context storage, never in this store." Do not create any tenant directories.
13. **Steering.** Replace the placeholder under "Care about" in `DREAM-STEERING.md` with the 3 to 6 failure types most relevant to this system, drawn from steps 2 to 11.

## Part 3: finish

14. Run `bin/memory index`, then `bin/memory check`. Fix every reported problem.
15. Each context file should end up with about 5 to 25 lines. Fewer is fine for a small repo. More usually means you are narrating code instead of recording what a session needs.
