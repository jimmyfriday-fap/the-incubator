import { describe, expect, it } from 'vitest';
import { looksBinary, normalizeText } from './normalize.js';

describe('normalizeText', () => {
  it('strips BOM, converts CRLF/CR, trims trailing whitespace and ends with one LF', () => {
    expect(normalizeText('﻿a \r\nb\t\rc\n\n\n')).toBe('a\nb\nc\n');
    expect(normalizeText('')).toBe('');
    expect(normalizeText('\n\n')).toBe('');
  });
  it('keeps Markdown hard breaks', () => {
    expect(normalizeText('line  \nnext   \n', { markdown: true })).toBe('line  \nnext  \n');
    expect(normalizeText('line  \n')).toBe('line\n');
  });
  it('is idempotent', () => {
    const once = normalizeText('x \r\n y\r\n');
    expect(normalizeText(once)).toBe(once);
  });
});

describe('looksBinary', () => {
  it('detects NUL bytes', () => {
    expect(looksBinary(new Uint8Array([65, 0, 66]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode('text'))).toBe(false);
  });
});
