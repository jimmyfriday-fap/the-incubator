---
name: conventions
tier: platform
description: Rules that hold everywhere: naming, data access, error handling, UI and styling constraints. Read before writing code.
last_verified: 2026-11-04
---

# Conventions

- [2026-11-04] [bootstrap] Every package is "type": "module" with nodenext resolution, verbatimModuleSyntax, strict, exactOptionalPropertyTypes and noUncheckedIndexedAccess; builds use tsc -b with project references. (src: docs/adr/001-monorepo-toolchain.md)
- [2026-11-04] [bootstrap] Each package's exports lists the custom condition @incubator/source (pointing at src/index.ts) ahead of default, so Vitest runs on sources without a build, while Node at runtime uses dist. (src: docs/adr/001-monorepo-toolchain.md, vitest.config.ts)
- [2026-11-04] [bootstrap] packages/spec/schema/incubator.schema.json is hand-authored and is the source of truth; src/types.gen.ts is generated and committed, and the spec:types test fails on any diff. (src: docs/adr/006-spec-schema-source-of-truth.md)
- [2026-11-04] [bootstrap] Templates are Eta files read as it.x (no useWith), with autoEscape false and autoTrim false, and they pass the restricted-template lint in packages/templates/src/template-lint.ts. (src: docs/adr/003-template-engine-eta.md, packages/templates/src/template-lint.ts)
- [2026-11-04] [bootstrap] Generated text files carry scaffold: regions delimited by comment markers; JSON files are changed by declarative patches, not by markers. (src: docs/adr/005-scaffold-markers-and-json-patches.md)
- [2026-11-04] [bootstrap] Fakes live in each package's testing entry (@incubator/<pkg>/testing), the standard harness is createEngine(fakeDeps()), and the unit project stubs the network. (src: docs/adr/015-test-strategy-fakes-and-live-gating.md, vitest.config.ts)
- [2026-11-04] [bootstrap] A secret value is held in a SecretString, which prints [REDACTED] from toString, toJSON and util.inspect, and the logger's redactor masks registered values. (src: docs/adr/009-secrets-and-redaction.md)
- [2026-11-04] [bootstrap] Files are LF: .gitattributes sets text=auto eol=lf and Prettier sets endOfLine lf, so write LF even on Windows. (src: .gitattributes, .prettierrc.json)
- [2026-11-04] [bootstrap] A script that is copied into the base pack (the guard toolkit, scripts/agent/*.mjs and .claude/settings.json) is edited in the repository and then copied with node scripts/packs-sync.mjs; the pack copy is never edited by hand. (src: scripts/packs-sync.mjs, scripts/dogfood.test.mjs)
- [2026-11-04] [bootstrap] A scaffold:memory region at the very top of CLAUDE.md holds the memory block and is preserved by pnpm agent:sync; the other generated agent files do not carry it. (src: scripts/agent/sync-instructions.mjs)
