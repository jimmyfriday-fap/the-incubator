# ADR-031: Add memory runs, where the agent commits and the owner decides the push

- **Status:** Accepted
- **Date:** 2026-11-03
- **Context doc:** [`docs/TDD.md`](../TDD.md) §7.7; [`docs/incubator-memory-feature.md`](../incubator-memory-feature.md);
  amends [ADR-023](023-local-folder-workflow.md) points 3 and 4 for Add memory runs only

## Context

The memory seed (`assets/memory-seed/`) holds a playbook that installs agent memory into a repository: it
scaffolds `.memory/`, adds skills and hooks, verifies the install in seven steps, and commits as it goes, on
`memory/bootstrap` under the `pr` policy or on the current branch under `direct`. The owner wants the
Incubator to run it as an action ("Add memory") instead of by hand. Under ADR-023 the agent never commits
and the owner approves every commit. The playbook's commits are part of its verification, and the seed is
read-only, so the playbook cannot be changed to leave its work uncommitted.

## Decision

1. **Repo mode only.** An Add memory run installs memory into one solution, with its store at `.memory/`.
   Store mode (several repositories sharing one store), Add member, Upgrade and Dream are deferred.
2. **The seed is never edited.** Each run copies the shipped seed into its run folder and hands the agent only
   the copy (`--add-dir`). The desktop app ships it unpacked and sets `INCUBATOR_MEMORY_SEED_DIR`.
3. **The agent commits (an exception to ADR-023 point 3).** The memory session may run `git add`,
   `git commit` and `git checkout -b memory/bootstrap`, so the playbook runs as written. It may not push, run
   `gh` or reach the network: `MEMORY_ALLOWED_TOOLS` lists every command it may run.
4. **The Incubator checks, then the owner decides the push (replacing ADR-023 point 4 for these runs).** After
   the agent stops, the Incubator checks for the report, a clean tree, at least one commit, an untouched
   `AGENTS.md`, changes only under the allowed paths, and the branch the policy names. A broken rule parks
   `memory_rules_broken`; a failed playbook verification parks `memory_verify_failed`. A passing install
   parks `needs_push` when the folder has a GitHub origin: push opens one pull request (`pr`) or pushes the
   branch (`direct`). Without an origin the install stays local. The Incubator never merges.
5. **Defaults.** Model `claude-opus-5-5` at effort `high`: a deploy runs once and its mistakes reach every later
   session. Effort is applied only when the CLI has a flag for it, and the run says when it was not.
6. **Recorded on the project.** `memory.installed` writes the store, policy and seed version to the portfolio
   project; later update runs start with a line that points the agent at `.memory/INDEX.md`.

## Alternatives considered

- **Keep ADR-023 as is: the agent leaves the install uncommitted and the owner commits.** Rejected: the
  playbook's verification reads its own commits, and the seed is read-only.
- **Let the agent push and open the pull request, as the playbook says.** Rejected: the push and the pull
  request stay the owner's decision, as for every other folder run.
- **Store mode in the same change.** Deferred: it needs a pause between discovery and install that the run
  model does not have yet.

## Consequences

- An Add memory run is the one folder run whose commits the owner reviews after the fact, through the
  report and the diff, rather than approving them first.
- The allowed-command list is the safety boundary; widening it needs a reason in this ADR's terms (no push,
  no `gh`, no network).
- The checks run again on every resume, so an owner who fixes the folder by hand can continue the run.

## Amendment (2026-11-06): the Incubator installs what the agent cannot write

The first live run (AC1, on a throwaway repository, Windows) parked `memory_rules_broken`: nothing was committed. Three
things the decision above assumed were not true of a headless Claude Code session.

- **Protected paths.** Claude Code treats `.claude/` and `.git/` as protected: in `acceptEdits` mode a write there
  needs an answer, a headless run has nobody to give it, and an allow rule does not pre-approve it. The agent could not
  write the skills, `.claude/settings.json` or the git pre-commit hook.
- **PowerShell.** `--allowedTools` only pre-approves commands. On Windows the session also had the PowerShell tool,
  which no entry in `MEMORY_ALLOWED_TOOLS` covers, so the agent's git calls through it were refused.
- **Compound commands.** Claude Code checks each part of `a && b`, a loop or a pipe against the allow list on its own.

Decision, replacing the parts of points 3 and 4 above that these facts break:

1. **The session has only the tools it needs.** The agent is launched with `--tools` set to `MEMORY_AVAILABLE_TOOLS`
   (the file tools and Bash; no PowerShell) and with `CLAUDE_CODE_USE_POWERSHELL_TOOL=0`. `MEMORY_ALLOWED_TOOLS` is
   still the list of commands it may run, and still holds no push, `gh` or network command. The prompt tells it to
   run one command per call and to leave the repository's build and test commands alone.
2. **The Incubator installs the protected files itself, after the agent stops.** The agent writes its skill stubs to a
   folder outside the repository; the Incubator copies the seed's three skills and the stubs into `.claude/skills/`,
   merges the SessionEnd hook into `.claude/settings.json`, installs the pre-commit hook (appending to an existing one),
   regenerates `.memory/INDEX.md` and commits these as one commit, `mem(platform): install memory skills and hooks
(Incubator)`. It touches only the paths `allowedMemoryPath` already allows, plus the hook under `.git/`. A hook path
   that lives inside the repository (`core.hooksPath`) is left to the owner, and the report says so.
3. **The Incubator runs the playbook's verification steps 4, 5 and 6.** They need the parts it installs: the hook
   rejects an undated line (a real `git commit`, undone if it is accepted), the hook is wired for the chosen policy,
   and the SessionEnd hook captures a transcript that git ignores. The agent reports `Verification 1–7: all passed
(4–6 left to the Incubator)`. Any failed check parks `memory_verify_failed`; the report the owner reads includes the
   Incubator's check lines.

Consequences: the agent no longer needs, and is not given, any path under `.claude/` or `.git/`. The seed is still
never edited; one defect found in it is for its owner: on Windows with python3 installed, `hooks/session-end` reads the
transcript path with a trailing carriage return and captures nothing. The hook exits 0 on any problem by design, so step 6
reports a **warning**, not a failure, when it runs but captures nothing (owner decision, 2026-11-06); it fails only when
the hook itself errors or the captured transcript is not ignored by git. Transcripts are not captured on such a machine
until the seed strips the `\r`.
