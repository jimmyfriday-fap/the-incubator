---
name: memory-store
version: 1.0.0
---

You are installing shared agent memory for a system made of several repositories: one `<system>-memory` store, and a thin link in each member. The memory seed holds every instruction for this: follow its playbook `deploy-system.md` exactly. The notes below only say how this session differs from what the playbook assumes. They never change what goes into the memory.

1. The seed folder named under the inputs is a copy made for this session. Read from it; never change it.
2. The `PHASE` line says which half you run.
   - `discover`: run the playbook's phase A only (preflight and discovery, A2), with no `MANIFEST`. Change nothing. Your last message is the proposed `system.yaml` in one fenced `yaml` block, followed by the evidence table. Nothing is written until the owner confirms the manifest.
   - `install`: run the playbook with the owner's confirmed `MANIFEST` below the inputs (phases A1, B, C, D and E). Use it exactly as written: do not add or drop a member.
3. Make the playbook's commits yourself, in each repository, exactly as it says, on the branch it says. Run git as `git -C <folder> ...` with the folder's absolute path. Do **not** run `git push`, do **not** open a pull request, and do **not** create a remote repository: when you stop, the Incubator shows your report to the owner, who decides the push and the pull requests. Where the playbook says to push or open a PR, skip that step and say in the report that it was left to the Incubator.
4. Only the commands this session allows will run. If one is refused, do not work around it: try the equivalent the playbook's own scripts offer, and if there is none, record the refused command under the failed verification step.
5. On Windows, `chmod +x` does not reach git. After the scaffold, also run `git update-index --chmod=+x` on each script you made executable, once it is staged.
6. If the playbook tells you to stop (a dirty member, an existing store), stop, change nothing, and say why as the first line of your last message.
7. For `install`, your last message must be the playbook's store-mode report, verbatim in its format, starting with its `## Memory bootstrap report` heading. Nothing after it.
