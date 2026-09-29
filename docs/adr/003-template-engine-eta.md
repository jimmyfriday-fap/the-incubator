# ADR-003: Eta (not Handlebars) as the template engine, with a restricted-template lint

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context

The brief asks for Eta or Handlebars. The templates produce GitHub Actions YAML, which is full of
`${{ ... }}`; generated scaffolder blueprints, which must keep literal `{{PLACEHOLDER}}` tokens; PHP;
JSX; and Jinja-like configs.

Handlebars' `{{ }}` delimiters collide with every one of these and can't be changed. Every such
occurrence would need escaping (`\{{`), which is error-prone and makes templates unreadable.

Eta's `<% %>` delimiters collide with none of our targets. However, Eta evaluates arbitrary
JavaScript, which threatens determinism.

## Decision

- Use **Eta 4.x**, pinned exactly, configured with `autoEscape: false`, `useWith: false` (templates
  must write `it.x`), `autoTrim: false` (whitespace is under explicit control), `cache: true` and
  `rmWhitespace: false`.
- **Restricted-template lint** (`packages/templates/scripts/template-lint.ts`, part of `check`):
  1. It tokenizes each `.eta` file and extracts JS from `<% %>`, `<%= %>` and `<%~ %>`.
  2. It parses the JS with the TypeScript parser.
  3. It rejects any identifier outside `{it, h}`, plus block-local variables and a small set of
     literals and control flow.
  4. It rejects member access on `Date`, `Math`, `process`, `globalThis`, `require`, `import`,
     `fetch`, `crypto`, `setTimeout` and `eval`.
- `h` is a frozen object of pure helpers (`slug`, `pascal`, `camel`, `indent`, `json`, `yamlStr`,
  `sortBy`, `action(id)` for SHA-pinned `uses:`). A type test asserts that the render context contains
  only data and these helpers.

## Consequences

- Templates stay readable, and GitHub Actions expressions need no escaping.
- Determinism rests on the lint plus golden byte-identity tests, not on the engine's
  logic-lessness.

## Alternatives considered

- **Handlebars with `strict: true`.** Rejected because of the delimiter collisions described above.
- **A home-grown `{{ }}` substitution.** Rejected: loops and conditionals are needed, and building our
  own engine is scope creep.
