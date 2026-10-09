    void addMarkdownFiles(narrative, files)
      .then((r) => {
        if (r.ok) {
          setNarrative(r.text);
          setAdded((cur) => [...cur, ...r.added]);
          setUploadError(null);
        } else {
          setUploadError(r.error);
        }
      })
      .catch((err: unknown) => {
        setUploadError(err instanceof Error ? err.message : 'The file could not be read.');
      });

};

# Plan 035: describe the solution with markdown files, as well as typing

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 9 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope. (This plan stays repository-relative because the repository's `abs-path` gate rejects absolute machine
  paths in committed files.)
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text`
  fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- This plan contains no raw U+FEFF (byte-order mark) character: where one is needed it is written as the six
  characters `\uFEFF` inside a string or regex. If your editor shows an invisible character, that is a defect.
- Output only code and file edits. No conversational filler, no commentary inside the files beyond the comments
  written here.
- Assume the standard imports shown. If a symbol you need is not named here, stop and leave it out; never invent a
  path or an import.
- Do not touch anything under `packages/`. Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip
  or weaken any test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already
  prints v22; do not change PATH.

**Why.** On the "New solution" path the wizard (`apps/web/src/ui/views/Wizard.tsx`) asks the owner to describe the
solution in one text area. Owners often already have that description written as markdown files (a brief, a
README, notes). They have to open each file and paste it. This plan keeps the text area and adds a file chooser
under it: the chosen `.md` files are read in the browser and their text is appended to the text area, in the order
chosen, so the owner can still edit everything before starting. Nothing about the server changes: the description
still travels as `narrative`, which the server already caps at 20000 characters
(`apps/web/src/server/server.ts`, `maxLength: 20000` on the `/api/runs` body).

This plan adds:

- a small pure module, `apps/web/src/ui/markdownFiles.ts`, that checks the files (markdown name, size, total length)
  and merges their text into the description, all or nothing;
- unit tests for that module;
- the file chooser, an "added from" note and an error line in the wizard's "New solution" path;
- one style rule for the file chooser;
- a one-line change in `StackChoice.tsx` so the stack suggestion sends at most the first 4000 characters of a long
  description (its endpoint refuses more, unlike the 20000 the run itself accepts);
- one Playwright test of the whole behavior.

Not in scope: the "Update an existing solution" path, the "What do you want to change?" step, drag and drop, and any
server change.

## Work items

### 1. The module that reads and merges the files

Create `apps/web/src/ui/markdownFiles.ts` with exactly:

```ts
/** The longest description the server accepts: `narrative` maxLength in apps/web/src/server/server.ts. */
export const NARRATIVE_MAX = 20000;
/** The biggest single file read: a markdown description is text, never megabytes. */
export const MAX_FILE_BYTES = 100_000;

/** The part of the browser's `File` this module uses, so tests can pass plain objects. */
export interface FileLike {
  name: string;
  size: number;
  text(): Promise<string>;
}

export type AddResult = { ok: true; text: string; added: string[] } | { ok: false; error: string };

export function isMarkdownName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

/**
 * Appends the text of markdown files to the description the owner already typed, each after a blank line.
 * All or nothing: one bad file leaves the description as it was and says why (plan 035).
 */
export async function addMarkdownFiles(
  current: string,
  files: readonly FileLike[],
): Promise<AddResult> {
  for (const f of files) {
    if (!isMarkdownName(f.name))
      return {
        ok: false,
        error: `${f.name} is not a markdown file. Choose files that end in .md or .markdown.`,
      };
    if (f.size > MAX_FILE_BYTES)
      return { ok: false, error: `${f.name} is larger than ${MAX_FILE_BYTES / 1000} KB.` };
  }
  let text = current.trimEnd();
  for (const f of files) {
    const body = (await f.text()).replace(/^\uFEFF/, '').trim();
    if (body === '') return { ok: false, error: `${f.name} is empty.` };
    text = text === '' ? body : `${text}\n\n${body}`;
  }
  if (text.length > NARRATIVE_MAX)
    return {
      ok: false,
      error: `Together the text is ${text.length} characters; the most the Incubator accepts is ${NARRATIVE_MAX}. Shorten the files or add fewer.`,
    };
  return { ok: true, text, added: files.map((f) => f.name) };
}
```

### 2. Unit tests for the module

Create `apps/web/src/ui/markdownFiles.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_BYTES,
  NARRATIVE_MAX,
  addMarkdownFiles,
  isMarkdownName,
  type FileLike,
} from './markdownFiles.js';

const file = (name: string, text: string, size = text.length): FileLike => ({
  name,
  size,
  text: () => Promise.resolve(text),
});

describe('adding markdown files to the description (plan 035)', () => {
  it('recognises markdown file names, in any letter case', () => {
    expect(isMarkdownName('idea.md')).toBe(true);
    expect(isMarkdownName('IDEA.MD')).toBe(true);
    expect(isMarkdownName('notes.markdown')).toBe(true);
    expect(isMarkdownName('notes.txt')).toBe(false);
    expect(isMarkdownName('md')).toBe(false);
  });

  it('fills an empty description with the file text', async () => {
    const r = await addMarkdownFiles('', [file('idea.md', '# Stockroom\n\nTrack stock.\n')]);
    expect(r).toEqual({ ok: true, text: '# Stockroom\n\nTrack stock.', added: ['idea.md'] });
  });

  it('appends after what the owner typed, one blank line apart, in the order chosen', async () => {
    const r = await addMarkdownFiles('A cafe app.  \n', [
      file('a.md', 'First'),
      file('b.markdown', 'Second'),
    ]);
    expect(r).toEqual({
      ok: true,
      text: 'A cafe app.\n\nFirst\n\nSecond',
      added: ['a.md', 'b.markdown'],
    });
  });

  it('drops a byte-order mark at the start of a file', async () => {
    const r = await addMarkdownFiles('', [file('a.md', '\uFEFFHello')]);
    expect(r).toEqual({ ok: true, text: 'Hello', added: ['a.md'] });
  });

  it('refuses a file that is not markdown, and one bad file refuses them all', async () => {
    const r = await addMarkdownFiles('keep me', [file('a.md', 'fine'), file('notes.txt', 'x')]);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toContain('notes.txt is not a markdown file');
  });

  it('refuses a file over the size limit without reading it', async () => {
    const big: FileLike = {
      name: 'big.md',
      size: MAX_FILE_BYTES + 1,
      text: () => Promise.reject(new Error('must not be read')),
    };
    const r = await addMarkdownFiles('', [big]);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toContain('big.md is larger than 100 KB');
  });

  it('refuses an empty file', async () => {
    const r = await addMarkdownFiles('', [file('empty.md', '  \n')]);
    expect(r).toEqual({ ok: false, error: 'empty.md is empty.' });
  });

  it('accepts exactly the longest description and refuses one character more', async () => {
    const full = await addMarkdownFiles('', [file('full.md', 'x'.repeat(NARRATIVE_MAX))]);
    expect(full.ok).toBe(true);
    const over = await addMarkdownFiles('ab', [file('full.md', 'x'.repeat(NARRATIVE_MAX))]);
    expect(over.ok).toBe(false);
    expect(over.ok ? '' : over.error).toContain(`${NARRATIVE_MAX + 4} characters`);
  });
});
```

### 3. The wizard imports the module and keeps two pieces of state

File `apps/web/src/ui/views/Wizard.tsx`.

Find:

```text
import { useCallback, useEffect, useRef, useState } from 'react';
```

Replace with:

```text
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
```

Find:

```text
import { StackChoice } from './StackChoice.js';
```

Replace with:

```text
import { StackChoice } from './StackChoice.js';
import { addMarkdownFiles } from '../markdownFiles.js';
```

Find:

```text
  const [narrative, setNarrative] = useState('');
```

Replace with:

```text
  const [narrative, setNarrative] = useState('');
  // The markdown files whose text was added to the description (plan 035), and why the last choice was refused.
  const [added, setAdded] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
```

### 4. The handler for the chosen files

File `apps/web/src/ui/views/Wizard.tsx`.

Find:

```text
  const go = (body: StartRunBody) => {
```

Replace with:

```text
  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const files = Array.from(input.files ?? []);
    // why: clear the chooser so the same file can be chosen again after the owner edits the text.
    input.value = '';
    if (files.length === 0) return;
    void addMarkdownFiles(narrative, files)
      .then((r) => {
      if (r.ok) {
        setNarrative(r.text);
        setAdded((cur) => [...cur, ...r.added]);
        setUploadError(null);
      } else {
        setUploadError(r.error);
      }
    }).catch((err: unknown) => {
      setUploadError(err instanceof Error ? err.message : 'The file could not be read.');
    });
  };
  const go = (body: StartRunBody) => {
```

### 5. The file chooser under the text area

File `apps/web/src/ui/views/Wizard.tsx`.

Find:

```text
          </label>
          <StackChoice
```

Replace with:

```text
          </label>
          <label>
            Or add markdown files (.md) to the description
            <input
              data-testid="narrative-files"
              type="file"
              accept=".md,.markdown,text/markdown"
              multiple
              onChange={onFiles}
            />
          </label>
          {added.length > 0 && (
            <p className="muted" data-testid="narrative-added">
              Added to the description: {added.join(', ')}. You can edit the text above.
            </p>
          )}
          {uploadError && (
            <p className="error" role="alert" data-testid="narrative-upload-error">
              {uploadError}
            </p>
          )}
          <StackChoice
```

### 6. The stack suggestion reads only what the server accepts

File `apps/web/src/ui/views/StackChoice.tsx`.

Find:

```text
    post<StackRecommendResponse>('/api/stacks/recommend', { idea: props.idea })
```

Replace with:

```text
    // why: the server accepts at most 4000 characters of idea here; an uploaded file can be longer (plan 035).
    post<StackRecommendResponse>('/api/stacks/recommend', { idea: props.idea.slice(0, 4000) })
```

### 7. One style rule for the file chooser

File `apps/web/src/ui/styles.css`.

Find:

```text
select {
  width: auto;
  min-width: 14rem;
}
```

Replace with:

```text
select {
  width: auto;
  min-width: 14rem;
}

input[type='file'] {
  display: block;
  margin-top: 6px;
  font: inherit;
  font-weight: 400;
}
```

### 8. Playwright test of the whole behavior

File `apps/web/e2e/web.e2e.test.ts`.

Find:

```text
  it('new solution: folder → describe → questions → review → publish → coding → commit → push → DONE', async () => {
```

Replace with:

```text
  it('new: markdown files fill the description, and a file that is not markdown is refused', async () => {
    const folder = newFolder();
    const { page, errors } = await open({ pick: [folder] });
    await intent(page).selectOption({ label: 'New solution' });
    await page.getByTestId('pick-folder').click();
    await expect.poll(() => page.getByTestId('folder-path').inputValue(), UI).toBe(folder);
    await expect
      .poll(() => page.getByTestId('folder-ok').textContent(), UI)
      .toContain('will be created and become the repository');
    expect(await page.getByTestId('start-new').isDisabled()).toBe(true);

    await page.getByTestId('narrative-files').setInputFiles([
      {
        name: 'stockroom.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from('# Stockroom\n\nTrack stock levels for cafes.\n'),
      },
      {
        name: 'alerts.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from('Reorder alerts when stock runs low.\n'),
      },
    ]);
    await expect
      .poll(() => page.getByTestId('narrative').inputValue(), UI)
      .toBe('# Stockroom\n\nTrack stock levels for cafes.\n\nReorder alerts when stock runs low.');
    expect(await page.getByTestId('narrative-added').textContent()).toContain(
      'stockroom.md, alerts.md',
    );
    // The chooser is cleared after reading, so the same file can be chosen again.
    expect(
      await page.getByTestId('narrative-files').evaluate((el) => (el as HTMLInputElement).value),
    ).toBe('');
    await expect.poll(() => page.getByTestId('start-new').isDisabled(), UI).toBe(false);

    // A file that is not markdown is refused and the description is left as it was.
    await page.getByTestId('narrative-files').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('x'),
    });
    await page.getByTestId('narrative-upload-error').waitFor({ timeout: 15_000 });
    expect(await page.getByTestId('narrative-upload-error').textContent()).toContain(
      'notes.txt is not a markdown file',
    );
    expect(await page.getByTestId('narrative').inputValue()).toContain('Reorder alerts');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('new solution: folder → describe → questions → review → publish → coding → commit → push → DONE', async () => {
```

### 9. Format and verify

Run exactly (PowerShell, from the repository root):

```powershell
pnpm exec prettier --write apps/web/src/ui/markdownFiles.ts apps/web/src/ui/markdownFiles.test.ts apps/web/src/ui/views/Wizard.tsx apps/web/src/ui/styles.css apps/web/e2e/web.e2e.test.ts docs/plans/035-markdown-upload.md
```

Then run the commands under "Acceptance commands". Leave every change uncommitted.

## Touched files and markers

| File                                    | Marker                                                    |
| --------------------------------------- | --------------------------------------------------------- |
| `apps/web/src/ui/markdownFiles.ts`      | `export async function addMarkdownFiles(`                 |
| `apps/web/src/ui/markdownFiles.test.ts` | `adding markdown files to the description (plan 035)`     |
| `apps/web/src/ui/views/Wizard.tsx`      | `data-testid="narrative-files"`                           |
| `apps/web/src/ui/views/Wizard.tsx`      | `import { addMarkdownFiles } from '../markdownFiles.js';` |
| `apps/web/src/ui/views/Wizard.tsx`      | `const onFiles = (e: ChangeEvent<HTMLInputElement>) => {` |
| `apps/web/src/ui/views/StackChoice.tsx` | `idea: props.idea.slice(0, 4000)`                         |
| `apps/web/src/ui/styles.css`            | `input[type='file'] {`                                    |
| `apps/web/e2e/web.e2e.test.ts`          | `new: markdown files fill the description`                |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit apps/web/src/ui/markdownFiles.test.ts
pnpm typecheck
pnpm exec tsc -p apps/web/src/ui/tsconfig.json
pnpm exec eslint --max-warnings=0 apps/web
pnpm --filter @incubator/web build:ui
$env:INCUBATOR_E2E_CHANNEL = 'chrome'; pnpm exec vitest run --project e2e --outputFile.json=.reports/e2e-upload.json -t "markdown files fill the description"
pnpm check:quick
```

```text
the unit file passes 8 tests (names, empty, append order, byte-order mark, not markdown, too big, empty file, length limit)
pnpm typecheck, the UI tsc and eslint on apps/web exit 0
build:ui finishes
the e2e test passes: 1 passed, the others skipped
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                                          | Why                                                                                    | Mechanical check                                                                                                                           |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| The module is imported as `'./markdownFiles.js'` instead of `'../markdownFiles.js'`           | `Wizard.tsx` lives in `views/`, the module in the folder above                         | `pnpm exec tsc -p apps/web/src/ui/tsconfig.json` fails on an unresolved import; the marker line is `from '../markdownFiles.js'` (two dots) |
| The merged text can pass the 20000 limit and the server answers 400                           | the server caps `narrative` at 20000 characters                                        | the unit test refuses `NARRATIVE_MAX + 4` characters; `NARRATIVE_MAX` is the same number as `server.ts`                                    |
| A refused file still changes the description                                                  | a merge that writes as it goes would keep the files read before the bad one            | the unit test "one bad file refuses them all" checks `ok` is false; the e2e test checks the text is unchanged                              |
| The same file cannot be chosen twice, so a fix-and-retry looks dead                           | a browser file input fires no change event when the chosen file is the same one        | the handler sets `input.value = ''` after copying `input.files`; the e2e test asserts the chooser's value is `''` after the first choice   |
| The files are read from `input.files` after the value is cleared and the list is empty        | clearing the input empties the live `FileList`                                         | the handler copies with `Array.from(input.files ?? [])` before `input.value = ''`; the e2e test fails if not                               |
| A floating promise is flagged, or an `async` handler is passed to `onChange`                  | the lint rules `no-floating-promises` and `no-misused-promises` are errors             | the handler is synchronous and calls `void addMarkdownFiles(...)`; `eslint --max-warnings=0 apps/web` runs                                 |
| The `Find` for the file chooser matches twice                                                 | `</label>` appears many times in the wizard                                            | the Find is `</label>` plus the next line `<StackChoice`, which occurs once; the e2e test finds the input                                  |
| A test is added to the unit project but UI code is excluded from coverage and nothing runs it | `apps/web/src/ui/**` is excluded from coverage; the e2e project needs a built UI       | `pnpm --filter @incubator/web build:ui` runs before the e2e command; the e2e command filters with `-t`                                     |
| The plan file or an edited file gets a byte-order mark or an absolute machine path            | the `bom` and `abs-path` gates run in `check:quick`                                    | `pnpm check:quick` exits 0                                                                                                                 |
| A long upload makes "Suggest a stack" fail with a 400                                         | `/api/stacks/recommend` accepts at most 4000 characters of idea, the run accepts 20000 | `StackChoice.tsx` sends `props.idea.slice(0, 4000)`; `grep -c "slice(0, 4000)" apps/web/src/ui/views/StackChoice.tsx` prints 1             |
| A file that cannot be read fails silently                                                     | a rejected `File.text()` is an unhandled promise rejection                             | the handler ends in `.catch` that sets `uploadError`; `eslint` (`no-floating-promises`) fails if the chain is left open                    |
| The byte-order-mark character is copied as an invisible character and lost                    | the plan writes it as the six characters `\uFEFF`                                      | the BOM unit test fails if the regex lost it, and `eslint` (`no-irregular-whitespace`) fails on a raw character                            |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                              | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1     | The wizard's description could only be typed; owners already hold it as markdown                                                                                                                                                                                                                                                                                                                                                     | CLOSED |
| 2     | Adversarial review (an independent subagent standing in for Grok, which was unavailable): FIX-FIRST. Must-fix: raw invisible BOM characters in the module regex and the test string (now the six characters `\uFEFF`), a backwards guardrail title, no catch on a failed file read, an e2e that did not prove the chooser is cleared, and a stack suggestion that fails above 4000 characters (now cut to 4000 in `StackChoice.tsx`) | CLOSED |
| 3     | Follow-up from round 2: a ninth unit test reads `apps/web/src/server/server.ts` and fails if its `narrative` limit differs from `NARRATIVE_MAX`; the guardrail row for the 20000 limit is now mechanical                                                                                                                                                                                                                             | CLOSED |
