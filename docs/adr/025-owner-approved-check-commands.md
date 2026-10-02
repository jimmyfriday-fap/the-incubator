# ADR-025: The owner approves what a coding agent runs in a repository the Incubator did not build

- **Status:** Accepted
- **Date:** 2026-10-02
- **Context doc:** [`docs/TDD.md`](../TDD.md) §7.5, §8, §11

## Context

The coding step was written for repositories the Incubator generated. Its prompt tells the agent to
read `CLAUDE.md`, fill `TODO(scaffold)` markers and run `node scripts/check.mjs quick`, and its
allowed-tool list lets the agent run only those Incubator scripts. In a repository the Incubator did
not build (any update of an existing project that has not adopted the canonical pattern, whatever its
stack) none of that exists: the agent could edit files and could not run a single test.

Letting the agent run "the repository's tests" means running commands that execute repository code,
chosen for a repository whose content is untrusted (threat T6).

## Decision

1. **Canonical or external.** A repository is canonical when it has `.incubator/lock.json`,
   `scripts/check.mjs` and `.incubator/agent-profile.json` at the moment the agent starts. Its
   behaviour does not change. Everything else is external.
2. **Proposals are constants.** At the scan, `proposeChecks` offers the ecosystem's own commands
   (`flutter analyze`, `go test ./...`, `npm run test`). Repository content only selects among built-in
   strings: which manifest exists, whether a script name from a fixed list is a key. No text from the
   repository, and nothing from a model, becomes part of a command.
3. **The owner decides.** The proposals are shown at review, editable, one per line. Approving the
   spec records the list as a journal entry (`enhance.checks`); it is not part of the spec, so there is
   no contract change. On the CLI, naming a command with `--check` is the approval, and `--no-checks`
   says "none". An empty list is a decision. `--yes` is never an approval.
4. **Validated.** `validateChecks` allows at most 8 commands of plain words (`A-Z a-z 0-9 _ @ % + = . / -`):
   no quotes, separators, pipes, redirects or substitutions, no `..`, no absolute program path. Shells,
   `git`, `sudo`, `env`, `xargs`, `curl`, `wget`, `rm` and `ssh` are refused. Runners that do anything
   with free arguments (`flutter`, `npm`, `node`, `python`, `cargo`, `make`, ...) need their subcommand
   in the approved text and may not carry an inline-code flag.
5. **Enforced through the agent's own tool list.** The agent gets the edit tools, `Bash(<command>:*)`
   for each approved command, and read-only `git status` and `git diff`. With nothing approved it gets
   no other `Bash` entry, the run records a warning, and the commit request says the work is untested.
   An agent CLI that cannot restrict tools parks the run (`checks_unenforceable`) instead of starting.
6. **Another prompt.** `handoff-external` assumes nothing the Incubator generates, tells the agent to
   follow the repository's own conventions, and lists the approved commands (or says there are none).
   The delivered lane templates name "the check commands the owner approved" instead of
   `pnpm check:quick`.
7. **The Incubator never runs them.** The commands are executed by the agent's own `Bash` tool. The
   rule that the Incubator spawns no subprocess through a shell (ADR-008) is about the Incubator's own
   code and is unchanged; a `.cmd` or `.bat` launcher such as `flutter.bat` is the agent CLI's concern.

## Alternatives considered

- **Edits only, always.** Safest, and the agent's work is never verified by anything.
- **A built-in allowlist per ecosystem, no approval.** The list would be decided in code for every
  repository, and "run the tests" in an unknown repository is exactly the decision the owner should make.
- **Storing the list in the spec.** It would be a second contract change, and it is a decision about one
  run on one machine, like the commit and the push (ADR-023), not a description of the project.

## Consequences

- An approved command runs repository code with the owner's rights. The approval is the control: the
  review screen says where each proposal came from, and the owner can delete any line.
- `Bash(<command>:*)` lets the agent append arguments to the approved text. Preventing a second command
  from being chained there is the agent CLI's guarantee; the validation keeps the approved text itself
  free of anything that could chain.
- The agent's result on an external repository is its own report. No Stop hook moves a ticket, so the
  commit request labels it as self-reported and names what the agent could run.
- The canonical test is a file check, which repository content can satisfy. A repository that forges
  those three files gets today's behaviour for Incubator-built repositories: no regression.
- Update runs that are not folder runs (`incubator handoff` from a workspace clone) get the external
  prompt and edit-only tools; approving commands for them is not offered yet.
