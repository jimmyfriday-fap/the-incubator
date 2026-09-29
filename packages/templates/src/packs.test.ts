// Bundled packs: every template passes the restricted-template lint, every manifest loads, and every
// stack × test-home × deploy combination in fixtures/combos renders deterministically to the pinned
// golden manifest (path, mode, sha256). Refresh goldens with INCUBATOR_GOLDEN_UPDATE=1 after a
// reviewed template change.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@incubator/runtime';
import { completeSpec, validateSemantics, validateSpec } from '@incubator/spec';
import { BUNDLED_PACKS_DIR, loadRegistry } from './registry.js';
import { render, type RenderResult } from './render.js';
import { lintTemplate } from './template-lint.js';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const comboDir = path.join(pkgRoot, 'fixtures/combos');
const goldenDir = path.join(pkgRoot, '__golden__');
const update = process.env['INCUBATOR_GOLDEN_UPDATE'] === '1';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function goldenManifest(r: RenderResult): string {
  return [...r.files.values()].map((f) => `${sha256Hex(f.bytes)} ${f.mode} ${f.path}\n`).join('');
}

describe('bundled packs', () => {
  it('every template passes the restricted-template lint', () => {
    const issues = walk(BUNDLED_PACKS_DIR)
      .filter((f) => f.endsWith('.eta'))
      .flatMap((f) => lintTemplate(path.relative(BUNDLED_PACKS_DIR, f), readFileSync(f, 'utf8')));
    expect(issues).toEqual([]);
  });

  it('every manifest is valid and every pack file is LF text without a BOM or absolute path', () => {
    const reg = loadRegistry();
    expect(reg.packs.size).toBeGreaterThanOrEqual(8);
    const bad: string[] = [];
    for (const pack of reg.packs.values()) {
      for (const [rel, bytes] of pack.files) {
        const t = bytes.toString('utf8');
        if (t.includes('\r')) bad.push(`${pack.manifest.id}/${rel}: CRLF`);
        if (t.charCodeAt(0) === 0xfeff) bad.push(`${pack.manifest.id}/${rel}: BOM`);
        // abs-path-lint: allow (the patterns below describe what is forbidden)
        if (/(^|[\s'"`(])(\/home\/[a-z]|\/Users\/[A-Za-z]|[A-Za-z]:\\\\?[A-Za-z])/.test(t))
          bad.push(`${pack.manifest.id}/${rel}: absolute path`);
      }
    }
    expect(bad).toEqual([]);
  });
});

const combos = readdirSync(comboDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

describe('pack combinations', () => {
  it('cover every stack pack, test home and deploy target', () => {
    const parts = combos.map((c) => c.split('.'));
    expect(new Set(parts.map((p) => p[1]))).toEqual(new Set(['in-repo', 'paired-repo']));
    expect(new Set(parts.map((p) => p[2]))).toEqual(
      new Set(['vps-tailscale', 'docker-host', 'package-release']),
    );
  });

  for (const name of combos) {
    it(`${name} renders to its golden manifest`, async () => {
      const { spec } = completeSpec(
        JSON.parse(readFileSync(path.join(comboDir, `${name}.json`), 'utf8')) as never,
      );
      expect(validateSpec(spec).ok).toBe(true);
      expect(validateSemantics(spec)).toEqual([]);
      const r = await render(spec);
      const [stack, home, deploy] = name.split('.');
      expect(r.packs.map((p) => p.manifest.id)).toEqual([
        'base',
        `stack/${stack!.startsWith('wordpress') ? 'wordpress' : stack}`,
        `deploy/${deploy}`,
        `test-home/${home}`,
      ]);
      for (const f of r.files.values()) {
        if (!/\.ya?ml$/.test(f.path) || !f.path.includes('.github/workflows/')) continue;
        for (const m of f.bytes.toString('utf8').matchAll(/uses:\s*(\S+)(.*)/g)) {
          if (m[1]!.startsWith('./')) continue;
          expect(`${m[1]}${m[2]}`, `${f.path}: ${m[0]}`).toMatch(/@[0-9a-f]{40} # v?\d/);
        }
      }
      const declared = new Set(
        [...r.settings.variables, ...r.settings.secrets].map(
          (d) => `${d.target === 'paired' ? '@paired/' : ''}${d.name}`,
        ),
      );
      const undeclared = new Set<string>();
      for (const f of r.files.values()) {
        if (!f.path.includes('.github/workflows/')) continue;
        const prefix = f.path.startsWith('@paired/') ? '@paired/' : '';
        for (const m of f.bytes.toString('utf8').matchAll(/\b(?:secrets|vars)\.([A-Z][A-Z0-9_]*)/g))
          if (m[1] !== 'GITHUB_TOKEN' && !declared.has(`${prefix}${m[1]}`))
            undeclared.add(`${f.path}: ${m[1]}`);
      }
      expect([...undeclared], 'workflow settings not declared in a pack manifest').toEqual([]);
      const golden = path.join(goldenDir, `${name}.txt`);
      const actual = goldenManifest(r);
      if (update) {
        mkdirSync(goldenDir, { recursive: true });
        writeFileSync(golden, actual);
      }
      expect(existsSync(golden), `no golden for ${name}; run with INCUBATOR_GOLDEN_UPDATE=1`).toBe(
        true,
      );
      expect(actual).toBe(readFileSync(golden, 'utf8'));
    });
  }
});
