# ADR-007: LLM adapters: capability probing, schema gate, tool-less sandbox

- **Status:** Accepted
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context
Local agent CLIs (claude, copilot, cursor-agent) change their flags and output formats often. They are
also *agents*: by default they can read and write files and run commands. Discovery and brownfield
analysis feed them untrusted text.

## Decision
- **Probe, don't hard-code.** `probe()` runs `<bin> --version` and `<bin> --help` (and `<bin> <sub>
  --help` where relevant). It then matches the help text against a table of candidate flag spellings
  for each capability:
  - `jsonOutput`;
  - `streamJson`;
  - `printMode`;
  - `stdinPrompt`;
  - `disableTools`;
  - `maxTurns`;
  - `model`.
  Results are cached per `(binPath, version)`.
- **Eligibility:** discovery requires `jsonOutput`, `printMode` and (`stdinPrompt` or an argv prompt
  under 8 KiB). Brownfield analysis additionally requires `disableTools`.
- **Sandbox:** `cwd` is a fresh `mkdtemp` directory, deleted afterwards. The environment is
  allowlisted (PATH, HOME/USERPROFILE, locale, and the adapter's own auth variables). Input goes on
  stdin.
- **Schema gate:** extract the first JSON object from the output (tolerating CLI envelopes such as
  `{result: "..."}` via per-adapter unwrap), then validate with Ajv. On failure, retry once with the
  errors appended. A second failure parks the run (`ParkError('llm_schema')`).
- **`anthropic-api`:** the official SDK. Structured output uses a single tool whose `input_schema` is
  the target schema, with `tool_choice` forced. The model comes from config and defaults to
  `claude-opus-5-5`.
- **`fake`:** replays fixtures keyed by `sha256(promptVersion ‖ schemaName ‖ normalizedPrompt)`.
  `INCUBATOR_RECORD=1` records them.

## Consequences
- Flag drift degrades an adapter to "ineligible" (visible in `doctor`) instead of breaking a run.
- Tests never need a logged-in CLI.

## Alternatives considered
- **Hard-coded flags per CLI version.** Rejected by the brief.
- **Letting CLIs read the repo themselves in brownfield.** Rejected: it hands an injection-exposed
  agent file-system tools.
