# ADR-001: Monorepo toolchain: pnpm 10, Node 22, TypeScript 6.0, ESM, source condition

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context

The brief fixes TypeScript, pnpm workspaces, Node 22 LTS, strict `tsc` and ESM. Two choices are left
open: the TypeScript major version, and how packages consume each other during development.

At the time of writing, `typescript@latest` is 7.0.x, the native port. `typescript-eslint` 8.71
declares `typescript: ">=4.8.4 <6.1.0"`, and the brief requires a real linter. Type-aware lint rules
are the main value of ESLint on a TypeScript codebase.

## Decision

- Pin **TypeScript `~6.0.3`**. Upgrade to 7.x when `typescript-eslint` supports it. The upgrade is
  tracked as a risk in `docs/TDD.md` §12.
- Pin **pnpm 10** via `packageManager` (Corepack), and Node `>=22.12 <23` via `engines` and `.nvmrc`.
- Every package is `"type": "module"`, `module`/`moduleResolution: nodenext`,
  `verbatimModuleSyntax`, `strict`, `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
- Builds use `tsc -b` with project references.
- Each package's `exports` has a custom condition, `"@incubator/source": "./src/index.ts"`, ahead of
  `"default": "./dist/index.js"`. Vitest and Vite set `resolve.conditions` to include it, so tests
  and the dev server run on sources with no prior build. Node at runtime uses `dist`.
- Orchestration is plain `pnpm -r` scripts. No Turborepo or Nx: the graph is small and caching adds a
  moving part to the cloud-session bootstrap.

## Consequences

- A fresh clone runs `pnpm install && pnpm check` with no build step first.
- One extra upgrade later (TS 7). Mechanical, since we avoid deprecated compiler options.

## Alternatives considered

- **TypeScript 7 without type-aware lint.** Rejected: loses the rules that catch floating promises and
  unsafe `any`.
- **Turborepo.** Rejected for now. Revisit if `pnpm check` exceeds about 3 minutes.
