import { describe, expect, it } from 'vitest';
import { main } from './main.js';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) },
  };
}

describe('cli main', () => {
  it('prints the version and exits 0', async () => {
    const t = io();
    expect(await main(['--version'], t.io)).toBe(0);
    expect(t.out.join('')).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
  it('exits 2 on usage errors', async () => {
    const t = io();
    expect(await main([], t.io)).toBe(2);
    expect(t.err.join('')).toContain('usage');
  });
});
