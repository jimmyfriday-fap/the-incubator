---
name: sync-pack-copies
description: Refreshes the copies of the guard toolkit that live in the base template pack, and the golden manifests that hash them. Use after editing any script that scripts/packs-sync.mjs copies, or .claude/settings.json.
---

# Sync pack copies

1. Run `node scripts/packs-sync.mjs`. It copies each changed file into `packages/templates/packs/base/files/`.
2. Run `node scripts/packs-sync.mjs --check`. It must print `0 stale`.
3. Refresh the golden manifests: set `INCUBATOR_GOLDEN_UPDATE=1`, run `pnpm exec vitest run --project unit packages/templates/src/packs.test.ts`, unset the variable, and run the same command again. Both runs must pass.
4. Review the diff of `packages/templates/__golden__`: only the sha256 lines of the changed files may differ.
5. If a base-pack file in the repository must differ from the rendered pack, add an entry with a reason to `.incubator/dogfood-exceptions.json`.

Status: stub from bootstrap; confirm with the owner on first real use.
