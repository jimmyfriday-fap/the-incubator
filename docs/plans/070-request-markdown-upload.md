# Plan 070: describe an update with a markdown file, and keep all of it

## Executor preamble

"What do you want to change?" (the update flow) was a text box only; markdown upload existed for a new solution
only (plan 035). It now has the same file chooser, using the same `addMarkdownFiles`: the files' text is added
to the box, and the owner can still edit it. The engine used to cut the request to 4,000 characters without
saying so, although the form and the API accept 20,000: `REQUEST_MAX` (20,000) now applies to the request the
run records, the earlier request offered again after a refresh, and `request.md`. Short summaries keep their
own caps.

## Touched files and markers

| File                                    | Marker                               |
| --------------------------------------- | ------------------------------------ |
| apps/web/src/ui/views/ChangeRequest.tsx | `data-testid="request-files"`        |
| packages/core/src/enhance.ts            | `export const REQUEST_MAX`           |
| packages/core/src/engine.ts             | `sanitizeRequest(text, REQUEST_MAX)` |
| apps/web/src/server/server.test.ts      | `keeps a long change request whole`  |
| apps/web/e2e/web.e2e.test.ts            | `request-files`                      |

## Acceptance commands

```bash
pnpm exec vitest run --project unit apps/web/src/server/server.test.ts
pnpm check:quick
```

```text
Tests  all passed
exit 0
```

## Drift and hallucination guardrails

| Trap                                      | Why                                   | Mechanical check                                   |
| ----------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| A long request is silently cut at 4,000   | `sanitizeRequest` defaults to 4,000   | server.test.ts "keeps a long change request whole" |
| The server limit is lost                  | The route allows 20,000 and no more   | server.test.ts 20,001 characters answer 400        |
| A non-markdown file is read into the text | The chooser's `accept` is only a hint | e2e: `notes.txt` shows `request-upload-error`      |

## Review rounds

| Round | Reviewer            | Finding                                   | Status |
| ----- | ------------------- | ----------------------------------------- | ------ |
| 1     | Claude (in-session) | Plan written and reviewed before dispatch | CLOSED |
