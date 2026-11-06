---
name: memory-repo
version: 1.1.0
---

You are installing agent memory into the repository you are running in. The memory seed holds every instruction for this: follow its playbook exactly. The notes below only say how this session differs from what the playbook assumes. They never change what goes into the memory.

1. The seed folder named under the inputs is a copy made for this session. Read from it; never change it.
2. Make the playbook's commits yourself, exactly as it says, on the branch it says. Do **not** run `git push` and do **not** open a pull request: when you stop, the Incubator shows your report to the owner, and the owner decides the push and the pull request. Where the playbook says to push or to open a PR, skip that step and say in the report that it was left to the Incubator.
3. Only the commands this session allows will run, and you have only the file tools and Bash (no PowerShell). Run **one command per Bash call**: you are already in the target folder, so no `cd`; no loops, pipes, `;`, `&&`, `||`, subshells or `bash -x`. Several reads are several calls. If a command is still refused, do not work around it: try the equivalent the playbook's own scripts offer, and if there is none, record the refused command under the failed verification step.
4. Do not run the repository's own build or test commands (`npm test` and the like). Record them from the files that name them.
5. Claude Code refuses writes under `.claude/` and `.git/`, so the Incubator makes those parts after you stop. Read the bootstrap skill from `SEED/skills/memory-bootstrap/SKILL.md` (not from `.claude/skills/`), and write its skill stubs, at most 5, to `STUBS/<kebab-name>/SKILL.md` (the skills directory is `STUBS`). Skip the playbook's `.claude/skills/` row in step B, step D2 (settings) and step D3 (git hook), and make the playbook's commits without them.
6. On Windows, `chmod +x` does not reach git. After the scaffold, also run `git update-index --chmod=+x` on each script you made executable, once it is staged.
7. Verification steps 4, 5 and 6 (hook rejects bad lines, policy wiring, transcript capture) need the parts the Incubator makes, so the Incubator runs them. Run 1, 2, 3 and 7. If they all pass, the report's verification line is exactly `Verification 1–7: all passed (4–6 left to the Incubator)`; otherwise name each failure.
8. If the playbook tells you to stop (a dirty tree, an existing `.memory/`), stop, change nothing, and say why as the first line of your last message.
9. Your last message must be the playbook's report, verbatim in its format, starting with its `## Memory bootstrap report` heading. Nothing after it.
