import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PolicyError, ToolError } from '@incubator/runtime';
import { fixturePacks, manifest, minimalPacks, spec } from './fixture.test-helper.js';
import { loadPack, packIntegrity } from './pack.js';
import { loadRegistry, packRefs, selectPacks } from './registry.js';
import { LOCK_PATH, globToRegExp, render } from './render.js';
import { describeTree, pairedRoot, writeTree } from './writer.js';

const text = (r: Awaited<ReturnType<typeof render>>, p: string) =>
  r.files.get(p)?.bytes.toString('utf8');

describe('pack loading', () => {
  it('validates manifests and file entries', () => {
    const bad = fixturePacks({ base: { 'pack.json': { id: 'base' } } });
    expect(() => loadRegistry(bad)).toThrow(/pack.json is invalid/);
    const missing = fixturePacks({
      base: {
        'pack.json': manifest('base', 'true', { files: [{ src: 'files/nope', dest: 'x' }] }),
      },
    });
    expect(() => loadRegistry(missing)).toThrow('file entry files/nope matches nothing');
    const empty = fixturePacks({ base: { 'readme.txt': 'no manifest' } });
    expect(() => loadPack(path.join(empty, 'base'))).toThrow('missing pack.json');
  });

  it('ignores tool caches and OS litter inside a pack', () => {
    const dir = fixturePacks({
      base: {
        'pack.json': manifest('base', 'true'),
        'files/__pycache__/x.pyc': 'junk',
        'files/.ruff_cache/y': 'junk',
        '.DS_Store': 'junk',
      },
    });
    const clean = fixturePacks({ base: { 'pack.json': manifest('base', 'true') } });
    const a = loadPack(path.join(dir, 'base'));
    expect([...a.files.keys()]).toEqual(['pack.json']);
    expect(a.integrity).toBe(loadPack(path.join(clean, 'base')).integrity);
  });

  it('computes an order-independent integrity hash over the pack files', () => {
    const a = new Map([
      ['a', Buffer.from('1')],
      ['b', Buffer.from('2')],
    ]);
    const b = new Map([
      ['b', Buffer.from('2')],
      ['a', Buffer.from('1')],
    ]);
    expect(packIntegrity(a)).toBe(packIntegrity(b));
    expect(packIntegrity(a)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(packIntegrity(new Map([['a', Buffer.from('x')]]))).not.toBe(packIntegrity(a));
  });

  it('selects exactly one pack per kind in composition order and honours pins', () => {
    const reg = loadRegistry(minimalPacks());
    expect(packRefs(selectPacks(reg, spec()))).toEqual([
      { id: 'base', version: '1.0.0' },
      { id: 'stack/node-web', version: '1.0.0' },
      { id: 'deploy/vps-tailscale', version: '1.0.0' },
      { id: 'test-home/in-repo', version: '1.0.0' },
    ]);
    expect(() =>
      selectPacks(
        reg,
        spec({
          stack: { pack: 'node-lib' },
          platform: 'library',
          deploy: { target: 'package-release' },
        }),
      ),
    ).toThrow('expected exactly one stack pack');
    expect(() =>
      selectPacks(reg, spec({ templates: { packs: [{ id: 'base', version: '9.0.0' }] } })),
    ).toThrow('spec pins base@9.0.0');
    expect(() =>
      selectPacks(
        reg,
        spec({ templates: { packs: [{ id: 'stack/wordpress', version: '1.0.0' }] } }),
      ),
    ).toThrow('does not apply to this spec');
  });
});

describe('render', () => {
  it('renders files, per-feature files, globs, modes, markers and JSON patches', async () => {
    const r = await render(spec(), loadRegistry(minimalPacks()));
    expect(text(r, 'README.md')).toBe(
      '# Stock Room\n\n<!-- <scaffold:cmds> -->\n<!-- @node -->\n\n1. pnpm install\n\n<!-- </scaffold:cmds> -->\n',
    );
    expect(text(r, 'src/app.ts')).toContain(
      '// @b\n// stack/node-web for stockroom\n// </scaffold:routes>',
    );
    expect(text(r, 'src/app.ts')).not.toContain('@skip');
    expect(text(r, 'src/features/inventory.ts')).toBe("export const id = 'inventory';\n");
    expect(JSON.parse(text(r, 'config/checks.json')!)).toEqual({
      profiles: { quick: ['bom', 'lint'] },
    });
    expect(r.files.get('tests/unit/a.test.ts')?.role).toBe('tests');
    expect(r.files.get('scripts/run.sh')?.mode).toBe('0755');
    expect(JSON.parse(text(r, 'incubator.json')!)).toMatchObject({
      project: { slug: 'stockroom' },
    });
    expect(r.lock.files['README.md']).toMatchObject({ pack: 'base', mode: '0644' });
    expect(Object.keys(r.lock.files)).not.toContain(LOCK_PATH);
    expect([...r.files.keys()]).toEqual([...r.files.keys()].sort());
    const noWeb = await render(spec({ platform: 'service' }), loadRegistry(minimalPacks()));
    expect(noWeb.files.has('scripts/run.sh')).toBe(false);
  });

  it('is byte-identical across runs and changes the lock when the spec changes', async () => {
    const reg = loadRegistry(minimalPacks());
    const [a, b] = [await render(spec(), reg), await render(spec(), reg)];
    expect([...a.files].map(([k, f]) => [k, f.bytes.toString('base64')])).toEqual(
      [...b.files].map(([k, f]) => [k, f.bytes.toString('base64')]),
    );
    const c = await render(
      spec({ project: { name: 'Other', slug: 'other', description: 'x' } }),
      reg,
    );
    expect(c.lock.specHash).not.toBe(a.lock.specHash);
  });

  it('relocates tests into the paired repository', async () => {
    const r = await render(
      spec({ testing: { home: 'paired-repo' } }),
      loadRegistry(minimalPacks()),
    );
    expect(r.files.has('tests/unit/a.test.ts')).toBe(false);
    expect(r.files.has('@paired/tests/unit/a.test.ts')).toBe(true);
  });

  it('refuses collisions, missing patch targets, bad templates and malformed output markers', async () => {
    const collide = minimalPacks({
      'deploy/vps-tailscale': {
        'pack.json': manifest('deploy/vps-tailscale', "deploy.target == 'vps-tailscale'", {
          files: [{ src: 'files/r.md', dest: 'README.md' }],
        }),
        'files/r.md': 'x\n',
      },
    });
    await expect(render(spec(), loadRegistry(collide))).rejects.toThrow('already owned by base');
    const target = minimalPacks({
      'deploy/vps-tailscale': {
        'pack.json': manifest('deploy/vps-tailscale', "deploy.target == 'vps-tailscale'", {
          markerPatches: [{ file: 'nope.md', region: 'r', entries: [] }],
        }),
      },
    });
    await expect(render(spec(), loadRegistry(target))).rejects.toThrow(
      'marker patch targets missing file nope.md',
    );
    const jsonTarget = minimalPacks({
      'deploy/vps-tailscale': {
        'pack.json': manifest('deploy/vps-tailscale', "deploy.target == 'vps-tailscale'", {
          jsonPatches: [{ file: 'nope.json', ops: [] }],
        }),
      },
    });
    await expect(render(spec(), loadRegistry(jsonTarget))).rejects.toThrow(
      'JSON patch targets missing file nope.json',
    );
    const broken = minimalPacks({
      'deploy/vps-tailscale': {
        'pack.json': manifest('deploy/vps-tailscale', "deploy.target == 'vps-tailscale'", {
          files: [{ src: 'files/x.txt.eta', dest: 'x.txt' }],
        }),
        'files/x.txt.eta': '<%= it.nope.deeper %>',
      },
    });
    await expect(render(spec(), loadRegistry(broken))).rejects.toThrow(ToolError);
    const shadowed = minimalPacks({
      'deploy/vps-tailscale': {
        'pack.json': manifest('deploy/vps-tailscale', "deploy.target == 'vps-tailscale'", {
          files: [{ src: 'files/t.txt.eta', dest: 't.txt' }],
        }),
        'files/t.txt.eta': '<%= typeof Date %>/<%= typeof process %>',
      },
    });
    expect(text(await render(spec(), loadRegistry(shadowed)), 't.txt')).toBe(
      'undefined/undefined\n',
    );
    const unclosed = minimalPacks({
      'deploy/vps-tailscale': {
        'pack.json': manifest('deploy/vps-tailscale', "deploy.target == 'vps-tailscale'", {
          files: [{ src: 'files/u.sh', dest: 'u.sh' }],
        }),
        'files/u.sh': '# <scaffold:open>\n',
      },
    });
    await expect(render(spec(), loadRegistry(unclosed))).rejects.toThrow(
      'malformed scaffold markers',
    );
    const invalidJson = minimalPacks({
      'deploy/vps-tailscale': {
        'pack.json': manifest('deploy/vps-tailscale', "deploy.target == 'vps-tailscale'", {
          files: [{ src: 'files/b.json.eta', dest: 'b.json' }],
        }),
        'files/b.json.eta': '{ nope',
      },
    });
    await expect(render(spec(), loadRegistry(invalidJson))).rejects.toThrow('is not valid json');
  });

  it('pins contract files in contracts.lock.json', async () => {
    const reg = loadRegistry(
      minimalPacks({
        'deploy/vps-tailscale': {
          'pack.json': manifest('deploy/vps-tailscale', "deploy.target == 'vps-tailscale'", {
            files: [{ src: 'files/contracts.json', dest: 'config/contracts.json' }],
          }),
          'files/contracts.json': { pinned: ['config/checks.json'] },
        },
      }),
    );
    const lock = JSON.parse(text(await render(spec(), reg), 'contracts.lock.json')!) as {
      files: Record<string, string>;
    };
    expect(Object.keys(lock.files)).toEqual(['config/checks.json']);
  });

  it('converts globs like the guard toolkit', () => {
    expect(globToRegExp('**/*.md').test('a/b/c.md')).toBe(true);
    expect(globToRegExp('**/*.md').test('c.md')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('a?.{json,yml}').test('ab.yml')).toBe(true);
  });
});

describe('writeTree', () => {
  const out = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'incubator-out-')), 'app');

  it('writes a fresh tree with modes and refuses a non-empty target without force', async () => {
    const r = await render(spec(), loadRegistry(minimalPacks()));
    const dir = out();
    const report = writeTree(r, dir, { mode: 'fresh' });
    expect(report.written.length).toBe(r.files.size);
    expect(readFileSync(path.join(dir, 'README.md'), 'utf8')).toBe(text(r, 'README.md'));
    if (process.platform !== 'win32')
      expect(statSync(path.join(dir, 'scripts/run.sh')).mode & 0o777).toBe(0o755);
    expect(() => writeTree(r, dir, { mode: 'fresh' })).toThrow(PolicyError);
    expect(writeTree(r, dir, { mode: 'fresh', force: true }).written.length).toBe(r.files.size);
    expect(describeTree(r)[0]).toMatch(/^[0-9a-f]{12} {2}0644 {2}/);
  });

  it('never overwrites in no-overwrite mode: identical files are skipped, others proposed', async () => {
    const r = await render(spec(), loadRegistry(minimalPacks()));
    const dir = out();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'README.md'), 'mine\n');
    writeFileSync(path.join(dir, 'incubator.json'), text(r, 'incubator.json')!);
    const report = writeTree(r, dir, { mode: 'no-overwrite' });
    expect(report.proposed).toEqual(['README.md']);
    expect(report.identical).toEqual(['incubator.json']);
    expect(readFileSync(path.join(dir, 'README.md'), 'utf8')).toBe('mine\n');
    expect(existsSync(path.join(dir, 'README.md.incubator-proposed'))).toBe(true);
    expect(() => writeTree(r, dir, { mode: 'no-overwrite' })).toThrow();
  });

  it('writes @paired/ files to a sibling tests repository', async () => {
    const r = await render(
      spec({ testing: { home: 'paired-repo', pairedRepo: { name: 'stockroom-tests' } } }),
      loadRegistry(minimalPacks()),
    );
    const dir = out();
    expect(() => writeTree(r, dir, { mode: 'fresh' })).toThrow('no pairedName');
    const report = writeTree(r, dir, { mode: 'fresh', pairedName: 'stockroom-tests' });
    expect(report.roots.paired).toBe(pairedRoot(dir, 'stockroom-tests'));
    expect(existsSync(path.join(report.roots.paired!, 'tests/unit/a.test.ts'))).toBe(true);
  });
});
