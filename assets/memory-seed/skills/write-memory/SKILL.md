---
name: write-memory
description: How to record a durable learning in this system's memory store. Use at the end of a task when you made a decision, fixed something likely to recur, or were corrected by the human.
---

# Write memory

1. Ask: would a future session do worse without this? If not, stop. Read `WRITE-RULES.md` in the store if unsure.
2. Pick the file from the WRITE-RULES table. Then check `PERMISSIONS.md` under this store's commit policy (`memory.conf`): with `pr`, platform changes go on a branch with a PR; with `direct`, you change the platform tier only if the human asked for it in this session, and otherwise you propose the line in your reply.
3. Re-read the target file now. If an existing line already covers this, edit that line instead of adding one.
4. Add one line at the top of the body: `- [YYYY-MM-DD] [claude-code] <fact in one sentence>. (src: <repo>:<file or commit>)`. Add ` (unconfirmed)` if you inferred it.
5. If you created or renamed a file or changed a `description:`, run `bin/memory index` from the store root (`.memory/bin/memory index` in repo mode).
6. Run `bin/memory check` and fix anything it reports.
7. Commit in the store, not in the application repo, following the repo's commit policy (branch + PR, or straight to the default branch). Message: `mem(<tier>): <summary>`, trailers `Session: <id>` and `Actor: claude-code`. In store mode that means `cd` into the store repo, commit, and push.

Aim for one to three lines per session. Volume is not the goal.
