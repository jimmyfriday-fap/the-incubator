---
name: handoff-continue
version: 1.2.0
---

An earlier session worked on this same plan and stopped before it finished: at a run limit, or with requests or checks left (listed below when so). The Incubator committed its work on this branch; the commits are listed below.

1. First find out what is already done: read the files the plan names, and run `git status` and `git diff` against the commit named after "since" below, if those commands are open to you.
2. Continue with the work items that are not done yet. Do not redo or undo finished work, and do not rewrite the earlier commits.
3. As before, leave your work as uncommitted changes. The Incubator commits each part, and the owner reviews the whole branch before anything is pushed.
4. If you find that every item is already done and the approved commands pass, do not stop with the tickets unmarked: set each finished request's ticket to `"READY_FOR_TEST"`, whatever state its file shows now. That is expected of you, not a decision for the owner.
