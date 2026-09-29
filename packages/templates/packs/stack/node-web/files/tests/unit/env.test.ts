import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnv, parseEnv } from '@app/server/env.js';

describe('env loading', () => {
  it('parses KEY=value lines', () => {
    expect(parseEnv('# c\nA=1\nB="two"\nC=\'3\'\nbad\n=x\n')).toEqual({ A: '1', B: 'two', C: '3' });
  });

  it('loads .env then private/.env; later files only fill gaps; the environment wins', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'env-'));
    mkdirSync(path.join(dir, 'private'));
    writeFileSync(path.join(dir, '.env'), 'A=from-env\nB=from-env\n');
    writeFileSync(path.join(dir, 'private', '.env'), 'B=from-private\nC=from-private\n');
    const env: NodeJS.ProcessEnv = { A: 'already-set' };
    const set = loadEnv([path.join(dir, '.env'), path.join(dir, 'private', '.env'), path.join(dir, 'missing')], env);
    expect(env).toEqual({ A: 'already-set', B: 'from-env', C: 'from-private' });
    expect(set).toEqual(['B', 'C']);
  });
});
