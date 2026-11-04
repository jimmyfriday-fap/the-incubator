## Memory

This repo is the `<repo>` member of the **<system>** system. Its memory lives in a separate repo, `<system>-memory`.
- Find the store: `$MEMORY_STORE_DIR` if set, otherwise the `path=` in `.memory-link` (relative to this repo). If neither resolves, tell the user once and continue without memory.
- At the start of any non-trivial task, read `<store>/INDEX.md`. Open the relevant `context/platform/` files and everything under `context/projects/<repo>/`.
- Skills for this system are listed in the index under `skills/`. Open a SKILL.md when its description matches your task.
- To record a learning, follow `<store>/skills/write-memory/SKILL.md`. Commit in the store repo, never in this repo.
- Never write memory about other systems.
