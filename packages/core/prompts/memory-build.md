---
name: memory-build
version: 1.0.0
---

You are giving a brand-new solution its agent memory, as one of two sessions of a build. The memory seed holds every instruction for this: follow the phases of its playbook that the inputs name, exactly. The notes below only say how this session differs from what the playbook assumes. They never change what goes into the memory.

1. The seed folder named under the inputs is a copy made for this session. Read from it; never change it.
2. The repository is new and the owner has not committed anything yet. You are on the build branch: stay on it, never switch branches, and never use the playbook's `memory/bootstrap` branch. The commit policy is `direct`, so commit on the branch you are on. Do **not** run `git push` and do **not** open a pull request.
3. Only the commands this session allows will run. If one is refused, do not work around it: try the equivalent the playbook's own scripts offer, and if there is none, say so in your last message.
4. On Windows, `chmod +x` does not reach git. Also run `git update-index --chmod=+x` on each script you made executable, once it is staged.
5. Never edit `AGENTS.md` and never change application code. Stage only the paths the playbook allows (`.memory`, `.claude/skills`, `.claude/settings.json`, `CLAUDE.md`), by name, never with `git add -A` or `git add .`.
6. If the playbook tells you to stop (an existing `.memory/`), stop, change nothing, and say why as the first line of your last message.

If the inputs say `PHASE: scaffold`:

- Do playbook phases A, B and D. Skip C (the bootstrap) and E (the verification): they run after the code exists. Phase A's clean-tree check applies to the working tree you start with.
- Make one commit with the message `mem(platform): scaffold memory infrastructure`, ending in the trailers `Actor: bootstrap` and `Session: manual`.
- Then seed `.memory/context/platform/decisions.md` from the description and the incubator.json choices you were given. Every choice the owner stated in the description (stack, scope, audience, things explicitly in or out) becomes one line: `- [<TODAY>] [bootstrap] <the choice, in one sentence>. (src: solution description)`, with **no** `(unconfirmed)`. A choice that appears only in the incubator.json list, because the Incubator chose it, becomes `- [<TODAY>] [bootstrap] <choice>. (src: incubator.json) (unconfirmed)`. Run `.memory/bin/memory index` and `.memory/bin/memory check`, and add the decisions to the same commit (amend it, or make a second commit with the same trailers).
- Your last message is one line: `Scaffold done: <number> decision lines.`

If the inputs say `PHASE: bootstrap`:

- The working tree holds the owner's uncommitted build work. That is expected: ignore it, never stage it, never restore or stash it. The playbook's clean-tree rule does not apply.
- Do playbook phases C and E: fill architecture, conventions, overview and status from the code that now exists, then verify. Everything you write cites its source and an inference gets `(unconfirmed)`.
- Make one commit of the memory paths only, with the message `mem(platform): bootstrap repo memory`, ending in the trailers `Actor: bootstrap` and `Session: manual`.
- Your last message must be the playbook's phase F report, verbatim in its format, starting with its `## Memory bootstrap report` heading. Nothing after it.
