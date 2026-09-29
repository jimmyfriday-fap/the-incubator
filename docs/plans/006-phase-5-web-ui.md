# Plan 006: Phase 5 — localhost web UI

## Executor preamble

Build `incubator ui`: a Fastify 5 server on 127.0.0.1 with a random port, serving a React 19 + Vite 8
UI that reuses the engine. The UI has four parts:

- a wizard (a narrative or a repository);
- CLARIFY cards;
- REVIEW, with a JSON-pointer spec diff, a decisions sidebar, an editor and a GitHub-owner field;
- a tree preview and an SSE run log.

Every request passes the ADR-011 checks:

- the Host header is exactly `127.0.0.1:<port>`;
- the Origin header matches when it is present, and on every non-GET request;
- a single-use launch token is exchanged for an HttpOnly, SameSite=Strict cookie;
- a synchronizer CSRF header is required on mutations;
- responses carry a CSP and no CORS headers.

Source of truth: `docs/TDD.md` §9.1–9.2 and §11 (T1, T5).

## Touched files and markers

| File or directory                                         | Marker / note                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/web/src/server/{security,origin}.ts`                | Guard: Host, Origin, launch token → cookie, CSRF; security headers        |
| `apps/web/src/server/{server,driver,spec-diff,static}.ts` | routes, SSE, background runs (parking web prompter), diff, UI assets      |
| `apps/web/src/api-types.ts`                               | API shapes shared by server and UI (types only)                           |
| `apps/web/src/ui/**`                                      | React UI, `vite.config.ts`, its own `tsconfig.json` (`typecheck-ui` step) |
| `apps/web/e2e/web.e2e.test.ts`                            | Playwright: greenfield, brownfield, cross-origin page                     |
| `packages/core/src/{preview,engine,testing}.ts`           | in-memory tree preview, revisions, fake LLM option for the fake engine    |
| `apps/cli/src/commands/ui.ts`                             | `incubator ui [--no-open]`                                                |
| `config/checks.json`, `vitest.config.ts`, `ci.yml`        | `typecheck-ui`, `ui-build`, `e2e` steps; `e2e` project; CI Chrome channel |

## Acceptance commands

```sh
pnpm vitest run --project unit apps/web apps/cli
pnpm test:e2e
```

```text
request security: no token / used token / forged cookie → 401; wrong Origin, wrong Host, missing or
wrong CSRF → 403
e2e: greenfield narrative → questions → review → DONE (published to the fake GitHub); brownfield
repository → review with delta statuses → DONE (pull request); a page on another origin can neither
read the API nor create a run
```

## Drift and hallucination guardrails

| Trap                                           | Why                                        | Mechanical check                                                                |
| ---------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| Another website drives the local API           | CSRF / DNS rebinding (threat T1)           | Guard unit tests for each rule; e2e from a second origin creates no run         |
| The launch token lingers or is reusable        | It passed through an OS URL handler        | single use (second use → 401); redirect strips it; test asserts the address bar |
| A file-preview path escapes to the file system | Path traversal (threat T5)                 | preview reads only the in-memory render; `../` → 404; asset resolver tests      |
| Inline script or style sneaks into the build   | The CSP would block it and the page breaks | Vite `assetsInlineLimit: 0`, no `style` props; e2e fails on any console error   |
| A web request blocks on a human answer         | Hung requests, lost state                  | the web prompter parks; answers resume from the journal (tests at each step)    |
| Fakes reachable from the shipped CLI           | A user run against a fake GitHub           | fakes live only in `src/testing-fixtures` (excluded from the build)             |

## Review rounds

| Round | Finding                                                                                     | Status |
| ----- | ------------------------------------------------------------------------------------------- | ------ |
| 1     | Publishing parked on an empty owner login from discovery; the review now asks for the owner | CLOSED |
| 2     | The tree panel asked for `/tree` before the spec was complete (409 in the console)          | CLOSED |
| 3     | Diffing against the empty revision showed a spurious root `{}` removal                      | CLOSED |
