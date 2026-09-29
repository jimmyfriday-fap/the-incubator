// Dogfood (TDD §10): this repository's own incubator.json is rendered, and every file the `base` pack
// owns must equal the repository byte for byte, unless .incubator/dogfood-exceptions.json lists it
// with a reason. The pack copies of the guard toolkit must also equal the repository's (packs-sync).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRegistry, render } from '../packages/templates/src/index.ts';
import { globToRegExp } from './guard/lib/common.mjs';
import { syncPlan } from './packs-sync.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { exceptions } = JSON.parse(
  readFileSync(path.join(root, '.incubator/dogfood-exceptions.json'), 'utf8'),
);

describe('dogfood', () => {
  it('every exception states a reason', () => {
    for (const e of exceptions) expect(e.reason?.length ?? 0, e.glob).toBeGreaterThan(20);
  });

  it('pack copies of the toolkit equal the repository (scripts/packs-sync.mjs --check)', () => {
    const stale = syncPlan(root).filter(([src, dest]) => {
      const d = path.join(root, dest);
      return !existsSync(d) || !readFileSync(d).equals(readFileSync(path.join(root, src)));
    });
    expect(stale.map(([, dest]) => dest)).toEqual([]);
  });

  it('no pack source is ignored by git (a fresh clone must carry every pack file)', () => {
    const r = spawnSync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', 'packages/templates/packs'],
      {
        cwd: root,
        encoding: 'utf8',
        shell: false,
      },
    );
    if (r.status !== 0) return; // not a git checkout
    expect(r.stdout.split('\n').filter((l) => l && !l.includes('/node_modules/'))).toEqual([]);
  });

  it("base renders this repository's own files byte for byte", async () => {
    const spec = JSON.parse(readFileSync(path.join(root, 'incubator.json'), 'utf8'));
    const r = await render(spec, loadRegistry());
    const res = exceptions.map((e) => ({ ...e, re: globToRegExp(e.glob), used: false }));
    const drift = [];
    let identical = 0;
    for (const f of r.files.values()) {
      if (f.pack !== 'base') continue;
      const abs = path.join(root, f.path);
      if (existsSync(abs) && readFileSync(abs).equals(f.bytes)) {
        identical++;
        continue;
      }
      const hit = res.find((e) => e.re.test(f.path));
      if (hit) hit.used = true;
      else drift.push(`${f.path}: ${existsSync(abs) ? 'differs' : 'missing'}`);
    }
    expect(drift).toEqual([]);
    expect(res.filter((e) => !e.used).map((e) => `stale exception ${e.glob}`)).toEqual([]);
    expect(identical).toBeGreaterThan(70);
  });
});
