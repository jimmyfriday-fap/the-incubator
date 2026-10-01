# ADR-023: Folder workflows, with the owner approving every commit and push

- **Status:** Accepted
- **Date:** 2026-10-01
- **Context doc:** [`docs/TDD.md`](../TDD.md) §7.5

## Context

Until now the agent worked in a run-workspace clone, committed on its own, and the owner could only
`incubator handoff --launch` from a terminal. The owner wants a wizard: pick a folder, let the agent code,
then be asked to commit and push based on what the agent reported.

## Decision

1. **New solution.** The selected folder itself is the repository. It must be empty or not exist (else it
   is refused, never cleared). The scaffold is rendered into it, `git init` runs there, and GitHub is
   created and pushed up front, as before. Coding then happens on `incubator/build-<date>`, because
   `main` deploys to staging.
2. **Update.** The scan, plan and delivery commit stay in the run-workspace clone, which keeps the A-only
   proof, replay safety and a scan that sees only committed files. The delivery branch is then fetched into
   the owner's folder and checked out there. The folder must be clean, and HEAD must not have moved since
   the scan. The owner's current branch is never written to.
3. **The agent no longer commits.** `git add`, `git commit` and `git checkout -b` leave the allowed tools,
   and the prompt says so (handoff 1.1.0).
4. **Commit and push are requests.** After the agent stops, the run parks at `needs_commit` with the changed
   files, the agent's verdict and final text, and a drafted message (editable). Commit uses the owner's own
   git identity. Then it parks at `needs_push` (push the branch and open one PR, or skip). Each is journaled
   and replay-safe.
5. **Same machinery for both paths**, and for the CLI (`resume --commit`, `--push`, `--skip-push`).

## Consequences

- The `COMMIT` and `PUSH` states are new run states. The agent's work is visible in the owner's IDE as
  uncommitted changes before any commit exists.
- The agent can no longer checkpoint its own work; a crash mid-iteration leaves uncommitted files, which the
  `coding_interrupted` park surfaces rather than hides.
- Existing `handoff --launch` behaviour changes the same way (no commit by the agent).

## Alternatives considered

- **Agent commits, owner approves push only.** Rejected by the owner: the commit is the decision.
- **Work in an isolated copy for Update.** Rejected by the owner in favour of their own folder on a branch.
- **A git worktree.** Rejected: the changes would not appear in the folder the owner picked.
