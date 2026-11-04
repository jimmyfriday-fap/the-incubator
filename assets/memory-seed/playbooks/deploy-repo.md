# Playbook: deploy memory into a single repo (repo mode)

You are installing the memory seed into **one repository**. The store goes inside the repo at `.memory/`. When you finish, every future Claude Code session in this repo starts by reading a small index, loads only what it needs, writes durable learnings back in a fixed format, and leaves a transcript that the dream pass can learn from.

## Inputs

| Input | Meaning | Default |
| --- | --- | --- |
| `TARGET` | Path to the repo | current directory |
| `SEED` | Path to the `memory-seed/` folder | must be provided |
| `ISOLATION_TERMS` | Distinctive code identifiers of OTHER systems whose knowledge must stay out of this repo's memory (function prefixes, plugin slugs, internal endpoints). Never brand names, domains, or hosts. | none (warn in report) |
| `COMMIT_POLICY` | `auto`, `pr`, or `direct` | `auto` (detect in A3) |
| `TODAY` | ISO date | today |

## Ground rules

1. Follow the repo's commit policy from A3. `pr`: work on branch `memory/bootstrap` and finish with a PR. `direct`: commit straight to the default branch, as the repo already does.
2. Change only: `.memory/**`, `.claude/skills/{write-memory,dream,memory-bootstrap}/**` plus bootstrap's skill stubs, `.claude/settings.json` (merge only), the root `CLAUDE.md`, and the git pre-commit hook. **Never edit `AGENTS.md`** or application code.
3. If the working tree isn't clean, stop and report. Don't stash, reset, or commit anyone else's work.
4. Cite every fact. Label every inference `(unconfirmed)`.
5. Never copy secrets, env values, customer or tenant data, or personal data.
6. Don't delete existing guidance. Content moved out of `CLAUDE.md` goes into `.memory/`.

## A. Preflight

1. `cd TARGET`; confirm `git rev-parse --show-toplevel` and that `git status --porcelain` is empty.
2. If `.memory/` or `.memory-link` already exists, stop: this is a first install, not an upgrade.
3. **Commit policy.** If `COMMIT_POLICY` is `pr` or `direct`, use it. If `auto`: read `AGENTS.md`, `CLAUDE.md`, and `CONTRIBUTING.md`. If any of them says to commit directly to main/master or not to use PRs, the policy is `direct`. If they require PRs or feature branches, it's `pr`. If they say nothing, check `git log --merges -20`: merge commits from PRs mean `pr`, none means `direct`. Record the evidence you used.
4. **Isolation terms.** For each term in `ISOLATION_TERMS`, run `git grep -il -- "<term>"`. If the term appears anywhere in this repo's own files, **drop it**: it names something this repo legitimately uses (shared hosting, a domain, an integration). Record dropped terms and a sample of where each appears.
5. Note whether these exist: `AGENTS.md`, `CLAUDE.md` (and whether it imports `@AGENTS.md`), `.claude/settings.json`, an existing pre-commit hook (`"$(git rev-parse --git-path hooks)/pre-commit"`), and `git config core.hooksPath`.
6. If the policy is `pr`: `git checkout -b memory/bootstrap`.

## B. Scaffold

Let `<repo>` be the repo directory's name. Create:

| Destination | Source |
| --- | --- |
| `.memory/README.md` | `SEED/templates/README-store.md` (replace `<store-prefix>` with `.memory/`) |
| `.memory/WRITE-RULES.md`, `DREAM-STEERING.md` | `SEED/templates/` same names |
| `.memory/PERMISSIONS.md` | `SEED/templates/PERMISSIONS.md`, with the policy line filled in. Delete the section for the other policy. |
| `.memory/memory.conf` | `SEED/templates/memory.conf` with `commit_policy=<pr|direct>` |
| `.memory/ISOLATION.txt` | `SEED/templates/ISOLATION.txt`, then one line per term kept in A4 |
| `.memory/.gitignore` | `SEED/templates/gitignore` |
| `.memory/.seed-version` | contents of `SEED/VERSION` |
| `.memory/bin/memory`, `.memory/hooks/pre-commit`, `.memory/hooks/session-end` | `SEED/bin/memory`, `SEED/hooks/*` (then `chmod +x`) |
| `.memory/transcripts/README.md` | `SEED/templates/transcripts-README.md` |
| `.memory/dreams/.gitkeep` | empty |
| `.memory/context/platform/*.md`, `.memory/context/projects/<repo>/*.md` | per `SEED/templates/context-files.md` |
| `.claude/skills/write-memory/`, `dream/`, `memory-bootstrap/` | `SEED/skills/` same names |

Replace every `<TODAY>`. Run `.memory/bin/memory index`.

## C. Bootstrap

Follow `.claude/skills/memory-bootstrap/SKILL.md` with one member, this repo. Paths are relative to `.memory/`; the skills directory is `.claude/skills/`. If `AGENTS.md` exists, it is a source, not a destination: don't duplicate its rules into memory (the skill explains).

## D. Wire

1. **CLAUDE.md.**
   - If CLAUDE.md is only an import such as `@AGENTS.md`, keep that line and add the contents of `SEED/templates/CLAUDE-block-repo.md` below it. Leave AGENTS.md whole.
   - Otherwise, move conventions, decisions, and architecture facts from CLAUDE.md into the matching `.memory/context/` file (actor `bootstrap`, `(src: CLAUDE.md)`). Keep a one-to-two-line description of the repo, its build/run/test commands, and any `@` imports. Put the memory block at the top.
   - Create CLAUDE.md if it's missing. If AGENTS.md exists, the new file contains `@AGENTS.md` and the memory block.
2. **Settings.** Merge into `.claude/settings.json` without overwriting other keys. If `SessionEnd` already exists, append to its array:
   ```json
   { "hooks": { "SessionEnd": [ { "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.memory/hooks/session-end" } ] } ] } }
   ```
   Check the Claude Code hooks documentation available to you. If `SessionEnd` isn't supported, use `Stop` and say so in the report.
3. **Git hook.** If `core.hooksPath` is set or a pre-commit hook exists, append `"$(git rev-parse --show-toplevel)/.memory/hooks/pre-commit" || exit 1` to it. Otherwise create it as `#!/usr/bin/env bash` + `exec "$(git rev-parse --show-toplevel)/.memory/hooks/pre-commit"` and `chmod +x` it.
4. Run `.memory/bin/memory index`.

## E. Verify (all must pass)

1. `.memory/bin/memory check` prints `memory check: ok`; `.memory/bin/memory stale` prints nothing.
2. Every context file except `status.md` and `platform/failures.md` has at least one line. Every `bootstrap` line has `(src: …)`. No memory line restates a rule that is already in AGENTS.md.
3. `git status --porcelain` shows changes only within the paths allowed by ground rule 2. `AGENTS.md` is unchanged (`git diff --quiet -- AGENTS.md`).
4. **Hook rejects bad lines:** add `- not a dated line` to `context/projects/<repo>/failures.md`, stage it, and try to commit. The commit must be rejected. Revert the line and unstage.
5. **Policy wiring:** `memory.conf` matches A3. With `pr`, confirm the hook's main/master guard is active. With `direct`, confirm the hook exits after its checks without the guard.
6. **Transcript capture:** `echo '{"session_id":"selftest","transcript_path":"'"$PWD"'/.memory/README.md"}' | CLAUDE_PROJECT_DIR="$PWD" .memory/hooks/session-end`. Confirm `.memory/transcripts/<TODAY>/selftest.jsonl` exists and is absent from `git status`, then delete it.
7. **Cold read:** using only CLAUDE.md (and anything it imports), `.memory/INDEX.md`, and the files the index points to, answer: "How do I build and test this repo, and what are the top three things a new session would most likely get wrong?" If you can't, fix the store and re-run checks 1 to 3.

## F. Deliver

1. Two commits: `mem(platform): scaffold memory infrastructure` (B and D) and `mem(platform): bootstrap repo memory` (C), both with `Actor: bootstrap`.
   - `pr`: on `memory/bootstrap`. Push and open a PR titled `Memory infrastructure v<seed version>`.
   - `direct`: on the default branch, as the repo normally commits. These install commits are the human-approved exception to the platform rule; with `direct` the guard is already off. Push if the repo normally pushes.
2. Report (in your reply, and in the PR body when there is one):
   ```
   ## Memory bootstrap report (repo mode)
   - Seed version: <v>
   - Commit policy: <pr | direct> (evidence: <file/line or git log>)
   - Context files: <n>; skills: 3 generic + <n> stubs
   - Lines: architecture <n>, conventions <n>, decisions <n>/<n>, failures <n>/<n>, status <n>
   - AGENTS.md: <absent | present, left unchanged; CLAUDE.md imports it>
   - Unconfirmed lines for owner review: <n>, each listed with its file
   - Moved out of CLAUDE.md: <n> lines
   - Hooks: SessionEnd <installed | used Stop | failed: why>; pre-commit <installed | appended | failed: why>
   - Isolation terms kept: <list>; dropped because the repo uses them: <term (where)>, ...
   - Verification 1–7: <all passed | failures>
   - Cold-read answer: <answer>
   - Suggested first owner edits: <up to 3>
   ```

Don't use the memory for other work in this session. The owner reviews the install first.
