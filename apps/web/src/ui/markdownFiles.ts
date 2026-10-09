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
