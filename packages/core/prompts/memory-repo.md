---
name: memory-repo
version: 1.0.0
---

You are installing agent memory into the repository you are running in. The memory seed holds every instruction for this: follow its playbook exactly. The notes below only say how this session differs from what the playbook assumes. They never change what goes into the memory.

1. The seed folder named under the inputs is a copy made for this session. Read from it; never change it.
2. Make the playbook's commits yourself, exactly as it says, on the branch it says. Do **not** run `git push` and do **not** open a pull request: when you stop, the Incubator shows your report to the owner, and the owner decides the push and the pull request. Where the playbook says to push or to open a PR, skip that step and say in the report that it was left to the Incubator.
3. Only the commands this session allows will run. If one is refused, do not work around it: try the equivalent the playbook's own scripts offer, and if there is none, record the refused command under the failed verification step.
4. On Windows, `chmod +x` does not reach git. After the scaffold, also run `git update-index --chmod=+x` on each script you made executable, once it is staged.
5. If the playbook tells you to stop (a dirty tree, an existing `.memory/`), stop, change nothing, and say why as the first line of your last message.
6. Your last message must be the playbook's report, verbatim in its format, starting with its `## Memory bootstrap report` heading. Nothing after it.
