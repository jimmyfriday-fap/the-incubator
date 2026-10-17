import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('the per-run temp root (plan 063)', () => {
  it('points the temp folder of every test at a folder under incubator-tests/run-', () => {
    const tmp = os.tmpdir();
    expect(path.basename(path.dirname(tmp))).toBe('incubator-tests');
    expect(path.basename(tmp)).toMatch(/^run-/);
    expect(existsSync(tmp)).toBe(true);
    expect(process.env['TMPDIR']).toBe(tmp);
  });
});
