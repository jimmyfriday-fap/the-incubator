# ADR-006: JSON Schema as the source of truth; generated types; Ajv

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context

`incubator.json` is validated in the CLI, the web UI, the LLM gate and generated repos. It must be
formally specified as JSON Schema draft 2020-12 (brief §4), with TypeScript types.

## Decision

- `packages/spec/schema/incubator.schema.json` is hand-authored and is the source of truth.
- `json-schema-to-typescript` generates `src/types.gen.ts`, which is committed. The `spec:types` test
  regenerates it and fails on any diff.
- Validation uses Ajv 2020 (`ajv/dist/2020`) with `strict: true`, `allErrors: true` and
  `ajv-formats`. Validators are compiled once and cached.
- Cross-field rules live in `validateSemantics(spec): Issue[]`, with stable issue codes.
- `defaults(partial) → Spec` fills every defaulted field and returns the `decisions[]` entries with
  `source: "default"`.
- The schema, `DiscoveryTurn`, scenario, deploy-tasks, pack and agent-profile schemas are
  SHA-256-pinned in `contracts.lock.json`.

## Consequences

- One schema serves the Ajv validator, the TS types, the LLM structured-output schema and editor
  completion (`$schema`).

## Alternatives considered

- **Zod as the source, exporting JSON Schema.** Rejected: the brief names JSON Schema 2020-12 as
  the contract, and generated repos consume the schema without TypeScript.
