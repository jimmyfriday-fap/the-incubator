# Playbook: deploy memory across a multi-repo system (store mode)

You are installing the memory seed for **a system made of several repos**. The system gets one dedicated store repo, `<system>-memory`. Each member repo gets only a thin pointer to it: a CLAUDE.md block, a `.memory-link` file, and a transcript hook. Knowledge that holds across members goes in the platform tier; each member's specifics go under `context/projects/<repo>/`.

## Inputs

| Input | Meaning | Default |
| --- | --- | --- |
| `WORKSPACE` | A directory where every member repo is checked out as a sibling folder | parent of the current repo |
| `SYSTEM` | System name, lowercase kebab-case (e.g. `backshack`) | must be provided |
| `SEED` | Path to the `memory-seed/` folder | must be provided |
| `MANIFEST` | A confirmed `system.yaml` (members, paths, roles, exclusions) | none: run Phase A2 and stop |
| `ENTRY_REPO` | The repo to start discovery from if no `MANIFEST` | current repo |
| `ISOLATION_TERMS` | Distinctive code identifiers of OTHER systems whose knowledge must stay out of this store (function prefixes, plugin slugs, internal endpoints). Never brand names, domains, or hosts. | none (warn in report) |
| `STORE_COMMIT_POLICY` | `pr` or `direct` for the store repo itself | `pr` |
| `MEMBER_COMMIT_POLICY` | `auto`, `pr`, or `direct` for each member's link commit | `auto` (detect per member in A1) |
| `STORE_REMOTE` | Git remote URL for the store repo, if one already exists | none: keep local, report |
| `TODAY` | ISO date | today |

## Ground rules

1. **The manifest is a human decision.** Without a confirmed `MANIFEST`, run discovery (A2), output the proposed manifest, and stop. Writing nothing is the correct outcome of a first run with no manifest.
2. In member repos, change only: `CLAUDE.md`, `.memory-link`, `.claude/hooks/memory-session-end`, `.claude/settings.json` (merge only), and `.claude/settings.local.json` (merge only, never committed). **Never edit `AGENTS.md`** or application code. Follow each member's commit policy from A1: `pr` means branch `memory/link` and a PR; `direct` means commit to its default branch.
3. In the store repo, follow `STORE_COMMIT_POLICY`. With `pr`, all content goes on branch `memory/bootstrap` and only the empty initial commit goes to `main`. With `direct`, everything goes to `main`.
4. Every member's tree must be clean before you start. If any isn't, stop and report which.
5. Cite every fact with its repo: `(src: <repo>:path)`. Label every inference `(unconfirmed)`.
6. Never copy secrets, env values, customer or tenant data, or personal data. No tenant directories, ever.
7. Don't create remote repositories. Use `STORE_REMOTE` if given; otherwise leave the store local and say so.

## A. Preflight and manifest

**A1. Preflight.** `WORKSPACE` exists. For each member in `MANIFEST` (or for `ENTRY_REPO` alone during discovery): it is a git repo, its tree is clean, and it has no existing `.memory/` or `.memory-link`. If `WORKSPACE/<SYSTEM>-memory` already exists, stop: this is a first install.

For each member, also:
- **Commit policy** (when `MEMBER_COMMIT_POLICY` is `auto`): read its `AGENTS.md`, `CLAUDE.md`, and `CONTRIBUTING.md`. Instructions to commit directly to main or not to use PRs mean `direct`; required PRs or feature branches mean `pr`. If they say nothing, use `git log --merges -20`: PR merges mean `pr`, none means `direct`. Record the evidence.
- **AGENTS.md:** note whether it exists and whether CLAUDE.md imports it.

**Isolation terms:** for each term in `ISOLATION_TERMS`, run `git grep -il -- "<term>"` in every member. If any member's own files contain the term, **drop it**: the system legitimately uses it (shared hosting, a domain, an integration). Record dropped terms with a sample location.

**A2. Discovery (only when no `MANIFEST`).** From `ENTRY_REPO`, look at every sibling repo in `WORKSPACE` for evidence of belonging to the same system: dependencies on each other (composer, npm, pip, go modules), shared function, class, table, or option prefixes, calls to each other's APIs or MCP endpoints, shared config keys, and mentions in CLAUDE.md or README files. Propose a manifest using `SEED/templates/system.yaml`:
- `members`: repos with at least two independent kinds of evidence, each with a role guess and a one-line reason that cites a file.
- `excluded`: repos with some evidence that look like a separate system, with the reason.

Output the proposed manifest and the evidence table, then **stop**. Make no changes.

## B. Create the store

1. `mkdir WORKSPACE/<SYSTEM>-memory && cd` into it; `git init -b main`.
2. Create `README.md` from `SEED/templates/README-store.md` (replace `<store-prefix>` with an empty string) and `.gitignore` from `SEED/templates/gitignore`. Commit to `main`: `mem(platform): initialize store`.
3. If `STORE_COMMIT_POLICY` is `pr`: `git checkout -b memory/bootstrap`.
4. Create:

| Destination (store root) | Source |
| --- | --- |
| `system.yaml` | the confirmed `MANIFEST`, with `seed_version` set to `SEED/VERSION` |
| `WRITE-RULES.md`, `DREAM-STEERING.md` | `SEED/templates/` same names |
| `PERMISSIONS.md` | `SEED/templates/PERMISSIONS.md`, with the policy line set to `STORE_COMMIT_POLICY`. Delete the section for the other policy. |
| `memory.conf` | `SEED/templates/memory.conf` with `commit_policy=<STORE_COMMIT_POLICY>` |
| `ISOLATION.txt` | `SEED/templates/ISOLATION.txt`, then one line per term kept in A1. For each `excluded` repo, add its distinctive code identifiers (not its name or domain) unless a member uses them. |
| `.seed-version` | contents of `SEED/VERSION` |
| `bin/memory`, `bin/redact-transcript.mjs`, `hooks/pre-commit`, `hooks/session-end` | `SEED/bin/*`, `SEED/hooks/*` (then `chmod +x`). The member hook reads `bin/redact-transcript.mjs` from the store and copies nothing without it. |
| `transcripts/README.md` | `SEED/templates/transcripts-README.md` |
| `dreams/.gitkeep` | empty |
| `context/platform/*.md` | per `SEED/templates/context-files.md` |
| `context/projects/<repo>/*.md` for every member | per `SEED/templates/context-files.md` |
| `skills/write-memory/`, `skills/dream/`, `skills/memory-bootstrap/` | `SEED/skills/` same names |

5. Replace every `<TODAY>`. Install the store's git hook: `.git/hooks/pre-commit` containing `#!/usr/bin/env bash` + `exec "$(git rev-parse --show-toplevel)/hooks/pre-commit"`, then `chmod +x`.
6. Run `bin/memory index`.

## C. Bootstrap

Follow `skills/memory-bootstrap/SKILL.md` from the store root, with every manifest member. Each member's source is at `WORKSPACE/<member path>`. A member's `AGENTS.md` is a source, not a destination: don't duplicate its rules into memory. Use subagents for Part 1 if available, one per member, each restricted to writing only under its own `context/projects/<repo>/`. Run Part 2 (reconcile) yourself after all members finish.

## D. Link the members

For each member, in its repo (on branch `memory/link` if its policy is `pr`, otherwise on its default branch):

1. **`.memory-link`** from `SEED/templates/memory-link`: `system=<SYSTEM>`, `repo=<repo>`, `path=` the relative path from the member to the store (normally `../<SYSTEM>-memory`), and `url=` set to `STORE_REMOTE` if given.
2. **CLAUDE.md.** The memory block is `SEED/templates/CLAUDE-block-member.md` with `<repo>` and `<system>` filled in.
   - If CLAUDE.md is only an import such as `@AGENTS.md`, keep it and add the memory block below. Leave AGENTS.md whole.
   - Otherwise, confirm that the conventions, decisions, and architecture facts in CLAUDE.md were captured in C, then remove them from CLAUDE.md. Keep a one-to-two-line description, the build/run/test commands, and any `@` imports. Put the memory block at the top.
   - If CLAUDE.md is missing, create it. When AGENTS.md exists, it contains `@AGENTS.md` and the memory block.
3. **Transcript hook.** Copy `SEED/hooks/session-end` to `.claude/hooks/memory-session-end` and `chmod +x` it (never an older copy of the hook: it must be the one that redacts, and the store must hold `bin/redact-transcript.mjs`). Merge into `.claude/settings.json`:
   ```json
   { "hooks": { "SessionEnd": [ { "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/memory-session-end" } ] } ] } }
   ```
   Check the Claude Code hooks docs available to you. If `SessionEnd` isn't supported, use `Stop` and report it.
4. **This machine's access (not committed).** Merge into `.claude/settings.local.json`, using the store's absolute path:
   ```json
   { "env": { "MEMORY_STORE_DIR": "<absolute path to store>" },
     "permissions": { "additionalDirectories": ["<absolute path to store>"] } }
   ```
   This is what makes the store reachable from Desktop worktrees, where the relative path in `.memory-link` doesn't resolve. Confirm `.claude/settings.local.json` is gitignored; if it isn't, add it to the member's `.gitignore`.
5. Commit per the member's policy (see F2).

## E. Verify (all must pass)

1. In the store: `bin/memory check` prints `memory check: ok`, and `bin/memory stale` prints nothing.
2. Every member has a `context/projects/<repo>/overview.md` with build/run/test commands. `context/platform/architecture.md` has one line per member and at least one cross-repo edge (or explains why there are none).
3. No `context/projects/*/conventions.md` remains (reconcile ran).
4. `ISOLATION.txt` contains every `excluded` repo name, and `check` passed.
5. **Store hook rejects bad lines:** add `- not a dated line` to one member's `failures.md` in the store, stage it, try to commit, confirm rejection, revert.
6. **Transcript capture, per member:** from the member root, `echo '{"session_id":"selftest","transcript_path":"'"$PWD"'/.memory-link"}' | CLAUDE_PROJECT_DIR="$PWD" .claude/hooks/memory-session-end`. Confirm `<store>/transcripts/<repo>/<TODAY>/selftest.jsonl` exists and is not tracked in the store's `git status`, then delete it.
7. Every member's `git status --porcelain` shows changes only to the files allowed by ground rule 2, `settings.local.json` isn't staged, and `AGENTS.md` is unchanged (`git diff --quiet -- AGENTS.md`).
7a. **Policy wiring:** the store's `memory.conf` matches `STORE_COMMIT_POLICY`, and no memory line restates a rule already in a member's AGENTS.md.
8. **Cold read, for two members:** using only that member's CLAUDE.md, the store `INDEX.md`, and the files the index points to, answer: "How do I build and test this repo, which other repos does it depend on, and what are the top three things a new session would get wrong?" If you can't, fix the store and re-run checks 1 to 4.

## F. Deliver

1. **Store:** commit `mem(platform): bootstrap <SYSTEM> memory`, `Actor: bootstrap`, on `memory/bootstrap` (`pr`) or `main` (`direct`; with `pr` this would need `MEMORY_ALLOW_SYSTEM=1`, so don't). If `STORE_REMOTE` is set, add it as `origin` and push. With `pr`, also open a PR. Otherwise leave the store local.
2. **Members:** commit `mem(link): connect <repo> to <SYSTEM>-memory`, `Actor: bootstrap`, following each member's policy. For `pr` members, push `memory/link` and open a PR whose body links to the store PR. For `direct` members, commit to the default branch and push if the repo normally pushes. Store content should land before member links.
3. Report:
   ```
   ## Memory bootstrap report (store mode): <SYSTEM>
   - Seed version: <v>
   - Members: <repo (role, commit policy + evidence, AGENTS.md yes/no)>, ...   Excluded: <repo (reason)>, ...
   - Store commit policy: <pr | direct>
   - Isolation terms kept: <list>; dropped because a member uses them: <term (where)>, ...
   - Platform lines: architecture <n>, conventions <n>, decisions <n>, failures <n>
   - Per member: <repo>: overview <n>, decisions <n>, failures <n>, status <n>, skill stubs <n>
   - Promoted to platform during reconcile: <n> conventions, <n> decisions
   - Cross-repo edges found: <n>
   - Unconfirmed lines for owner review: <n>, each listed with its file
   - Tenancy detected: <no | yes, PERMISSIONS note added>
   - Hooks: SessionEnd <installed in n members | used Stop | failures>; store pre-commit <installed>
   - Store remote: <pushed to … | local only at …>
   - Member PRs: <links or branches>
   - Verification 1–8: <all passed | failures>
   - Cold-read answers: <two answers>
   - Suggested first owner edits: <up to 3>
   ```

## Adding a member later

Run A1 for the new repo only, add it to `system.yaml` on a branch, create its `context/projects/<repo>/` files, run bootstrap Part 1 for it alone, then run Part 2 for the whole system (reconcile may now promote lines), then do D for the new member and E. Deliver it as one store PR plus one member PR.

## Upgrading the seed

Copy only `bin/`, `hooks/`, and `skills/{write-memory,dream,memory-bootstrap}/` from the new seed, plus any member `.claude/hooks/memory-session-end`. Update `seed_version` and `.seed-version`. Never overwrite `context/`, `DREAM-STEERING.md`, `ISOLATION.txt`, `memory.conf`, or `system.yaml`. If the store has no `memory.conf` (pre-1.0.1), create one with `commit_policy=pr`. Rule-file changes (`WRITE-RULES.md`, `PERMISSIONS.md`) get applied as a diff for the owner to review. Run E1, then open one PR.
