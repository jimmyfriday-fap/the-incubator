import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { completeSpec } from '@incubator/spec';
import { render, writeTree } from '@incubator/templates';
import { analyze } from './detectors.js';
import { checkItem, gapReport, loadCanonical, summarizeGaps } from './canonical.js';
import { draftFromAnalysis } from './draft.js';
import { isEmptyDelta, planDelta } from './delta.js';
import { renderGapReport } from './report.js';
import { viewFromDir, viewFromFiles } from './repo-view.js';

const fixtures = fileURLToPath(new URL('../fixtures', import.meta.url));
const update = process.env['INCUBATOR_GOLDEN_UPDATE'] === '1';
const owner = { type: 'user' as const, login: 'octo' };

/** The compliant fixture is rendered at test time from its incubator.json, so it tracks the packs. */
async function compliantRepo(): Promise<string> {
  const spec = completeSpec(
    JSON.parse(readFileSync(path.join(fixtures, 'compliant/incubator.json'), 'utf8')) as never,
  ).spec;
  const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'compliant-')), 'repo');
  writeTree(await render(spec), dir, { mode: 'fresh' });
  return dir;
}

function snapshot(name: string, value: unknown): void {
  const file = path.join(fixtures, name, 'expected-gap-report.json');
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (update || !existsSync(file)) {
    if (!update) throw new Error(`missing ${file}; run with INCUBATOR_GOLDEN_UPDATE=1`);
    writeFileSync(file, text);
  }
  expect(text).toBe(readFileSync(file, 'utf8'));
}

describe('detectors', () => {
  it.each([
    ['bare-node', { pack: 'node-web', platform: 'web', confidence: 'medium' }, 'order-desk', 2],
    [
      'wp-plugin',
      { pack: 'wordpress', platform: 'wordpress-plugin', confidence: 'high' },
      'Guest Book',
      1,
    ],
    [
      'python-service',
      { pack: 'python-service', platform: 'service', confidence: 'high' },
      'rate-relay',
      2,
    ],
  ])('%s', (name, stack, projectName, tests) => {
    const a = analyze(viewFromDir(path.join(fixtures, name)));
    expect(a.stack).toMatchObject(stack);
    expect(a.name).toBe(projectName);
    expect(a.tests.count).toBe(tests);
    expect(a.hasSpec).toBe(false);
  });

  it('detects libraries, CLIs, themes and deploy classes from manifests', () => {
    expect(
      analyze(viewFromFiles({ 'package.json': '{"name":"@o/lib","exports":"./x.js"}' })).stack,
    ).toMatchObject({ pack: 'node-lib', platform: 'library' });
    expect(
      analyze(viewFromFiles({ 'package.json': '{"name":"tool","bin":{"t":"x"}}' })).deploy.target,
    ).toBe('package-release');
    expect(
      analyze(viewFromFiles({ 'style.css': '/*\nTheme Name: Harbour\n*/' })).stack,
    ).toMatchObject({ pack: 'wordpress', framework: 'wordpress-theme' });
    const pm2 = analyze(
      viewFromFiles({
        'package.json': '{"dependencies":{"fastify":"1","react":"1"}}',
        'ecosystem.config.cjs': '',
      }),
    );
    expect([pm2.stack?.confidence, pm2.deploy.target]).toEqual(['high', 'vps-tailscale']);
    expect(analyze(viewFromFiles({ 'README.md': '# nothing' })).stack).toBeNull();
    expect(analyze(viewFromFiles({ 'package.json': 'not json' })).stack).toBeNull();
  });

  it('never follows symlinks or reads binaries', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'view-'));
    writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([1, 0, 2]));
    mkdirSync(path.join(dir, 'node_modules'));
    writeFileSync(path.join(dir, 'node_modules', 'x.js'), '');
    const v = viewFromDir(dir);
    expect(v.files).toEqual(['bin.dat']);
    expect(v.read('bin.dat')).toBeNull();
    expect(v.read('missing')).toBeNull();
  });
});

describe('canonical checks and gap reports', () => {
  it('rates items present, partial or missing', () => {
    const [claude, hooks, lanes] = ['agent.claude-md', 'agent.settings-hooks', 'lanes.index'].map(
      (id) => loadCanonical().find((i) => i.id === id)!,
    );
    const v = viewFromFiles({ '.claude/settings.json': '{}', '.incubator/lanes/index.json': '{}' });
    expect(checkItem(v, claude!).status).toBe('missing');
    expect(checkItem(v, hooks!).status).toBe('partial');
    expect(checkItem(v, lanes!)).toMatchObject({
      status: 'partial',
      detail: ['.incubator/lanes/**/enrich.md', '.incubator/lanes/**/codegen.md'],
    });
  });

  it.each(['bare-node', 'wp-plugin', 'python-service'])(
    '%s matches its expected gap report',
    (name) => {
      const view = viewFromDir(path.join(fixtures, name));
      const a = analyze(view);
      const items = gapReport(view, a.stack?.pack ?? null);
      snapshot(name, {
        stack: a.stack,
        summary: summarizeGaps(items),
        items: items.map((i) => `${i.status} ${i.id}`),
      });
    },
  );

  it('a repository the Incubator generated is fully compliant with an empty delta', async () => {
    const dir = await compliantRepo();
    const view = viewFromDir(dir);
    const a = analyze(view);
    expect(a.hasSpec).toBe(true);
    const items = gapReport(view, a.stack?.pack ?? null);
    expect(items.filter((i) => i.status !== 'present')).toEqual([]);
    const spec = completeSpec(
      JSON.parse(readFileSync(path.join(dir, 'incubator.json'), 'utf8')) as never,
    ).spec;
    const delta = planDelta(await render(spec), dir);
    expect(isEmptyDelta(delta)).toBe(true);
    expect(renderGapReport(a, items, delta)).toContain('0 file(s) are added, 0 conflicting');
  });
});

describe('draft from analysis', () => {
  it('infers stack, platform and deploy with evidence, never security fields', () => {
    const a = analyze(viewFromDir(path.join(fixtures, 'python-service')));
    const { spec, inferred } = draftFromAnalysis(a, { repoName: 'rate-relay', owner });
    expect(spec).toMatchObject({
      mode: 'brownfield',
      platform: 'service',
      stack: { pack: 'python-service' },
      deploy: { target: 'docker-host' },
      project: { slug: 'rate-relay', visibility: 'private' },
    });
    expect(inferred.map((d) => d.key)).toEqual([
      'platform',
      'stack.pack',
      'stack.framework',
      'project.name',
      'deploy.target',
    ]);
    expect(inferred.find((d) => d.key === 'stack.pack')!.question).toContain(
      'pyproject.toml: depends on fastapi',
    );
    expect(spec.decisions.find((d) => d.key === 'project.visibility')?.source).toBe('default');
    expect(() => draftFromAnalysis(analyze(viewFromFiles({})), { repoName: 'x', owner })).toThrow(
      'no supported stack',
    );
  });

  it('proposes conflicting files instead of overwriting them', async () => {
    const root = path.join(fixtures, 'bare-node');
    const { spec } = draftFromAnalysis(analyze(viewFromDir(root)), {
      repoName: 'order-desk',
      owner,
    });
    const delta = planDelta(await render(spec), root);
    expect(delta.proposed).toEqual(
      expect.arrayContaining(['.gitignore', 'README.md', 'package.json']),
    );
    expect(delta.create).toContain('CLAUDE.md');
    expect(delta.identical).toEqual([]);
    const md = renderGapReport(
      analyze(viewFromDir(root)),
      gapReport(viewFromDir(root), 'node-web'),
      delta,
    );
    expect(md).toContain('`package.json` → `package.json.incubator-proposed`');
    expect(md).toContain('❌ missing | `agent.claude-md`');
  });
});
