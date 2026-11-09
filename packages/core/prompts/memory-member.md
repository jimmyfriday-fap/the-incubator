---
name: memory-member
version: 1.1.0
---

You are adding one repository to a system that already has a shared `<system>-memory` store. The memory seed holds every instruction for this: follow the "Adding a member later" section of its `deploy-system.md` exactly. The notes below only say how this session differs from what the playbook assumes. They never change what goes into the memory.

1. The seed folder named under the inputs is a copy made for this session. Read from it; never change it.
2. The owner has already confirmed the manifest below the inputs: it is the store's `system.yaml` with the new member added. Use it exactly: do not add or drop another member.
3. The `PHASE` line says which part you run.
   - `full`: the repository exists and has code. Run the whole section: A1 for the new repository, the manifest change, its `context/projects/<repo>/` files, bootstrap Part 1 for it alone, Part 2 for the whole system, then D (the link) and E (verify).
   - `link`: the repository is brand new and has no code yet. Run only the manifest change, create its `context/projects/<repo>/` files as empty stubs seeded from the owner's description if the inputs give one, and D (the link). Skip bootstrap and the reconcile: there is nothing to read yet.
   - `bootstrap`: the repository now has code, and its link is already committed. Run only bootstrap Part 1 for this repository and Part 2 for the whole system, then E. Change nothing in the repository itself: its uncommitted files are the owner's work.
4. Make the playbook's commits yourself, exactly as it says, on the branch it says. Run git as `git -C <folder> ...` with the absolute folder (the inputs name the repository and the store). Do **not** run `git push`, do **not** open a pull request and do **not** create a remote repository: when you stop, the Incubator shows your report to the owner, who decides what is pushed. Where the playbook says to push or open a PR, skip that step and say in the report that it was left to the Incubator.
5. Only the commands this session allows will run, and you have only the file tools and Bash (no PowerShell). Run **one command per Bash call**, and run git as `git -C <folder> ...` with the absolute folder (the inputs name the repository and the store) instead of `cd`: no loops, pipes, `;`, `&&`, `||`, subshells or `bash -x`. Several reads are several calls. If a command is still refused, do not work around it: try the equivalent the playbook's own scripts offer, and if there is none, record the refused command under the failed verification step.
6. On Windows, `chmod +x` does not reach git. Run `git update-index --chmod=+x` on each script you made executable, once it is staged.
7. Claude Code refuses writes under `.claude/` and `.git/`, so the Incubator makes those parts after you stop. Skip step D3 (`.claude/hooks/memory-session-end` and its `.claude/settings.json` entry) and step D4 (`.claude/settings.local.json` and its `.gitignore` line). Never touch `.claude/` or `.git/`. Verification steps 5 and 6 need those parts, so the Incubator runs them; leave them out of your verification line and write it as `Verification 1–8: all passed (5–6 left to the Incubator)` when the others pass, otherwise name each failure.
8. If the playbook tells you to stop (a dirty tree, an existing link), stop, change nothing, and say why as the first line of your last message.
9. For `full` and `bootstrap`, your last message must be the playbook's report, verbatim in its format, starting with its `## Memory bootstrap report` heading. Nothing after it.
