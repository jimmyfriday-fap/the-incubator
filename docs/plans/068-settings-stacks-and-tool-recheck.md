# Plan 068: Settings lists every stack, and a tool's version can be checked again

## Executor preamble

Settings gets a Stacks tab that lists the catalog (`GET /api/stacks`: label, id, how it is built, summary,
platforms), and a "Check again" button under Accounts & about. The version beside a tool (for example
`claude-cli 2.1.306`) is not a pin: it is the first line of the tool's own `--version`, read when the app first
asked and remembered for as long as the server runs, so an update showed the old number until a restart.
`LlmRegistry.refresh()` makes each adapter forget and ask again; saving a tool location does the same. No
contract file and no run ceiling changes. Flutter is already in the catalog and the recommender (plan 068 adds
no stack).

## Touched files and markers

| File                               | Marker                                |
| ---------------------------------- | ------------------------------------- |
| packages/llm/src/types.ts          | `reprobe?(): Promise<Capabilities>`   |
| packages/llm/src/cli-adapter.ts    | `reprobe(): Promise<Capabilities>`    |
| packages/llm/src/registry.ts       | `async refresh()`                     |
| packages/core/src/settings.ts      | `opts: { recheck?: boolean }`         |
| apps/web/src/server/server.ts      | `/api/settings/recheck`               |
| apps/web/src/ui/views/Settings.tsx | `data-testid="recheck-tools"`         |
| packages/llm/src/llm.test.ts       | `checking a tool again`               |
| packages/core/src/settings.test.ts | `asks the tools again only when told` |
| apps/web/src/server/server.test.ts | `checks the tools again on request`   |

## Acceptance commands

```bash
pnpm exec vitest run --project unit packages/llm/src/llm.test.ts packages/core/src/settings.test.ts apps/web/src/server/server.test.ts
pnpm check:quick
```

```text
Tests  all passed
exit 0
```

## Drift and hallucination guardrails

| Trap                                     | Why                                              | Mechanical check                                     |
| ---------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| Every page load runs the tools again     | `--version` per tool per load is slow on Windows | settings.test.ts: `view()` asks 0 times              |
| The version is treated as a contract pin | Nothing in `contracts.lock.json` holds it        | no change to config/contracts.json or contracts.lock |
| The stack list drifts from the catalog   | The tab would show a stack the recommender lacks | server.test.ts compares ids with `STACK_CATALOG`     |

## Review rounds

| Round | Reviewer            | Finding                                   | Status |
| ----- | ------------------- | ----------------------------------------- | ------ |
| 1     | Claude (in-session) | Plan written and reviewed before dispatch | CLOSED |
