import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(import.meta.dirname, 'styles.css'), 'utf8');

describe('the stylesheet (plan 023)', () => {
  it('defines every token it uses', () => {
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    expect([...used].filter((t) => !defined.has(t))).toEqual([]);
  });

  it('carries the Backshack palette and the Inter font', () => {
    expect(css).toContain('--primary: #4f46e5;');
    expect(css).toContain('--nav: #1e293b;');
    expect(css).toContain("'Inter Variable'");
  });
});
