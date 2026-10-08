import { readFileSync } from 'node:fs';
import path from 'node:path';
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

describe('adding markdown files to the description (plan 033)', () => {
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
  it('uses the same longest description as the server accepts', () => {
    const server = readFileSync(path.join(import.meta.dirname, '../server/server.ts'), 'utf8');
    expect(server).toContain(`narrative: { type: 'string', maxLength: ${NARRATIVE_MAX} }`);
  });
});
