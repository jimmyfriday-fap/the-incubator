# Feature spec: "Add memory" for the-incubator

## Summary

Give the-incubator the ability to install agent memory infrastructure into a solution the user selects, whether that solution is one repo or a system of several repos. The incubator ships a versioned **memory seed** (attached as `memory-seed/`) and runs one of its two playbooks against the selection. Every deploy ends in pull requests the user reviews. Nothing is written to a default branch.

The seed holds all the memory logic. The incubator's job is to choose the mode, gather inputs, run the right playbook in an agent session, and record the result. Keep the incubator-side code thin. When the memory design changes, the seed changes, not the incubator.

## What to add to the incubator

### 1. Ship the seed as a versioned asset

- Add the attached `memory-seed/` folder to the incubator's repo unchanged (suggested path: `assets/memory-seed/`).
- Read its version from `memory-seed/VERSION`. Treat the folder as read-only at runtime: deploys copy from it and never modify it.
- Future seed updates arrive by replacing the folder and bumping `VERSION`.

### 2. A new action: "Add memory"

Available from the solution list, next to "Update an existing solution". Its inputs:

| Field           | Type                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target          | one solution, or several | Multi-select. One selection → repo mode. Two or more → store mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| System name     | text, kebab-case         | Default: the solution's name in repo mode. Required in store mode (e.g. `backshack`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Isolation terms | list, prefilled          | **Prefill with the distinctive code identifiers of every other solution the incubator knows about that is not in this target**: function or class prefixes, plugin or package slugs, internal endpoint hosts. **Not** brand names, domains, or server names, because solutions often share hosting (e.g. one served from another's domain). Add a per-solution `identifiers` field to the solution registry to hold these. The playbook also drops any term the target's own code uses. The user can edit the list. This is the main anti-conflation control. |
| Commit policy   | `auto` / `pr` / `direct` | Default `auto`: the playbook detects it from AGENTS.md, CLAUDE.md, CONTRIBUTING.md, or git history. Store mode adds a separate store policy (default `pr`).                                                                                                                                                                                                                                                                                                                                                                                                   |
| Store remote    | URL, optional            | Store mode only. If empty, the store stays local and the report says so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Model / effort  | select                   | Default: Opus-class model, high effort.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### 3. Running it

Use the mechanism the incubator already uses to run an agent session against a solution. The only addition is which files and inputs that session receives.

**Repo mode (one solution selected)**

- Session workspace: that solution's repo.
- Give the session `memory-seed/` and the instruction: "Follow `memory-seed/playbooks/deploy-repo.md` with these inputs:" followed by `TARGET`, `SEED`, `ISOLATION_TERMS`, `COMMIT_POLICY`, `TODAY`.
- One run. Output: the install (as a PR, or as commits on main for `direct` repos) plus the report.

**Store mode (two or more solutions selected)**

- Session workspace: a directory where all the selected repos are checked out as **siblings**. If the incubator keeps solutions in separate places, create a temporary workspace directory and check each one out into it. The playbook relies on relative sibling paths.
- **Run 1 (discovery):** give the session `memory-seed/playbooks/deploy-system.md` with `SYSTEM`, `SEED`, `ENTRY_REPO` (the first selected repo), and `ISOLATION_TERMS`, and no `MANIFEST`. The playbook proposes a `system.yaml` plus an evidence table, then stops.
- **Confirmation step (UI):** show the proposed manifest. Selected repos are prechecked as members, repos the session discovered are offered as additions, `excluded` repos are shown with reasons, and each member's role can be edited. The user confirms or edits. This is the single human decision in the flow. Do not skip it or auto-confirm it.
- **Run 2 (install):** the same playbook again with `MANIFEST` set to the confirmed YAML, plus `STORE_COMMIT_POLICY`, `MEMBER_COMMIT_POLICY`, and `STORE_REMOTE` if given. Output: the store (with a PR when its policy is `pr`), one link change per member following that member's policy, and the report.

If the incubator has no way to pause between runs, show the manifest as Run 1's output and have the user launch Run 2 from it.

### 4. Record the result on each solution

Store on each affected solution:

| Field                  | Example                                                |
| ---------------------- | ------------------------------------------------------ |
| `memory.mode`          | `repo` or `member`                                     |
| `memory.system`        | `backshack`                                            |
| `memory.store`         | `.memory/` (repo mode) or the store repo's path or URL |
| `memory.seed_version`  | `1.1.0`                                                |
| `memory.commit_policy` | `pr` or `direct`                                       |
| `memory.installed_at`  | date                                                   |
| `memory.report`        | the playbook's final report                            |

Use this to show memory status on each solution, to disable "Add memory" on solutions that already have it, and to prefill isolation terms for other solutions' future deploys. A solution that belongs to a system is never offered as a member of a different system.

### 5. Follow-on actions

| Action         | Shown when                                           | What it does                                                                                                                        |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Add member     | a system already has a store                         | Runs the "Adding a member later" section of `deploy-system.md` for the new repo                                                     |
| Upgrade memory | `memory.seed_version` is older than the shipped seed | Runs the "Upgrading the seed" section; never touches `context/`                                                                     |
| Dream          | memory is installed                                  | Starts a session at the store root with "Run `skills/dream/SKILL.md`" (repo mode: `.claude/skills/dream/SKILL.md`). Manual for now. |

### 6. Carrying memory into later work

When the incubator runs "Update an existing solution" on a solution that has `memory.mode` set, prepend one line to the session's instructions: "This solution has a memory store at `<memory.store>`. Read its INDEX.md before starting, and follow the write-memory skill at the end." This makes every incubator-driven change a consumer of memory, and a contributor to it.

## Rules the implementation must keep

1. Never auto-confirm a store-mode manifest.
2. Never run a deploy on a solution with uncommitted changes. Surface the playbook's preflight failure as-is.
3. Never create a remote repository unless the user entered a remote URL.
4. Never merge the PRs the playbooks open. For `direct` repos, the report is the review artifact: show it prominently.
   4a. Never edit a target's `AGENTS.md`.
5. Never pass one system's content into another system's deploy. The only cross-system information allowed is the list of isolation terms.
6. The seed folder is copied from, never edited, at runtime.

## Acceptance criteria

1. **Repo mode:** select one solution (e.g. rolling-schedule) → "Add memory" → an install containing `.memory/`, the three generic skills under `.claude/skills/`, the CLAUDE.md block, and the hook wiring, delivered per the repo's commit policy. The report shows verification 1–7 passed and lists any isolation terms dropped because the repo uses them. AGENTS.md is unchanged.
2. **Store mode, discovery:** select two or more solutions → Run 1 changes no files and displays a proposed manifest with evidence.
3. **Store mode, install:** after confirmation → a `<system>-memory` store (local, or pushed if a remote was given) plus one PR per member. Report verification 1–8 passed.
4. **Isolation:** after both a rolling-schedule (repo mode) and a backshack (store mode) deploy, `bin/memory check` passes in both stores. Each store's `ISOLATION.txt` contains the other system's code identifiers, and none of the shared hosting, domain, or server names.
5. **Status:** both solutions show their memory mode, system, and seed version. "Add memory" is disabled on them.
6. **Upgrade:** bump the shipped seed `VERSION` → "Upgrade memory" appears; running it changes only `bin/`, `hooks/`, generic skills, and version markers.
7. **Consumption:** a later "Update an existing solution" run on a memory-enabled solution reads INDEX.md first (visible in its transcript).

## Out of scope for this version

- Scheduled dream runs (run them manually from the action until the first few dream PRs have been reviewed).
- Creating GitHub repos on the user's behalf.
- Tenant-scoped memory. The seed deliberately keeps tenant data out of every store.
- Editing memory content from the incubator UI. Memory is edited through PRs.
- Upgrade and Dream (plan 079 WI-3 and WI-4, deferred). Repo mode (plan 071, ADR-031), store mode and Add member
  (Part 2, ADR-032) are built, and so are adopting an existing store and the Backshack report (plan 079 WI-2).
  Store mode keeps everything local: the Incubator makes the store's commits and pushes nothing; the owner
  decides what to push. Memory is also on by default for a new build, and update runs on a project with no
  memory offer Add memory (they never install it).

## Doing it without code changes (works today)

- **Single repo:** run "Update an existing solution" on the repo, attach `memory-seed/`, and describe the work as: "Follow `memory-seed/playbooks/deploy-repo.md`. Isolation terms: <other systems' code identifiers>."
- **Multi-repo:** this doesn't fit "Update an existing solution", which targets one repo. Instead, open a Claude Code session in a parent folder that contains all the member repos as siblings, attach `memory-seed/`, and run `deploy-system.md` twice: once without a manifest to get the proposal, then again with the manifest you've confirmed.

## Adopting a store, the Backshack report and GitHub-named members (plan 079 WI-2)

An existing store that was built by hand is registered with `incubator memory-adopt <store-folder>`. It reads the store's `system.yaml` and `memory.conf`, records the system and its members in the portfolio, and writes nothing in the store or in any member. `incubator memory-system backshack [--root <folder>]` lists the eight Backshack repositories, the folder of each (found by its git origin), and whether it is a member; it changes nothing, and it warns while the user-level Claude settings set `MEMORY_STORE_DIR`. Add member names a repository after its GitHub repo (`o/site.cloud` becomes `site.cloud`) and falls back to the folder name. When the repository's `.gitignore` is an allowlist that hides the hook files, the Incubator appends the exact `!` lines (and the folders above them), commits them with the hook, and checks again; if the files are still ignored the run parks. Creating a new store keeps the side-by-side rule and the folder names.
