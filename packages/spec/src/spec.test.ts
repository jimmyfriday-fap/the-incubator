import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  changedPaths,
  completeSpec,
  covers,
  deepMerge,
  defaultsFor,
  getAt,
  isSupportedSpecVersion,
  serializeSpec,
  setAt,
  slugify,
  specHash,
  validateAgainst,
  validateDiscoveryTurn,
  validateDraft,
  validateSemantics,
  validateSpec,
  type IncubatorSpec,
} from './index.js';

const packs = ['node-web', 'python-service', 'wordpress', 'node-lib'] as const;

describe('defaults', () => {
  it.each(packs)('produce a valid, semantically sound spec for %s', (pack) => {
    const { spec, added } = completeSpec({ stack: { pack }, project: { name: `My ${pack} App` } });
    expect(validateSpec(spec).issues).toEqual([]);
    expect(validateSemantics(spec)).toEqual([]);
    expect(added.length).toBeGreaterThan(10);
    expect(added.every((d) => d.source === 'default')).toBe(true);
    expect(added.map((d) => d.key)).not.toContain('project.name');
  });

  it('infers the pack from the platform and handles themes and paired repos', () => {
    expect(defaultsFor({ platform: 'cli' }).stack.pack).toBe('node-lib');
    expect(defaultsFor({ platform: 'cli' }).deploy.target).toBe('package-release');
    expect(defaultsFor({ platform: 'wordpress-theme' }).stack.framework).toBe('wordpress-theme');
    const paired = defaultsFor({ project: { slug: 'shop' }, testing: { home: 'paired-repo' } });
    expect(paired.testing.pairedRepo).toEqual({ name: 'shop-tests' });
    expect(defaultsFor({}).stack.pack).toBe('node-web');
  });

  it('keeps drafted values and existing decisions', () => {
    const { spec, added } = completeSpec({
      project: { name: 'X', slug: 'xx' },
      stack: { pack: 'node-web' },
      testing: { coverageThreshold: 90 },
      decisions: [{ key: 'deploy', question: 'q', answer: 'docker', source: 'user' }],
    });
    expect(spec.testing.coverageThreshold).toBe(90);
    expect(added.map((d) => d.key).filter((k) => k.startsWith('deploy'))).toEqual([]);
    expect(spec.decisions[0]?.source).toBe('user');
  });

  it('slugifies names', () => {
    expect(slugify('Café Order Tracker!')).toBe('cafe-order-tracker');
    expect(slugify('A')).toBe('project-a');
    expect(slugify('***')).toBe('project-x');
    expect(slugify('x'.repeat(150))).toHaveLength(100);
  });
});

describe('schema validation', () => {
  const good = completeSpec({ stack: { pack: 'node-web' }, project: { name: 'Shop' } }).spec;

  it('rejects unknown fields, bad enums and bad patterns with readable issues', () => {
    const bad = structuredClone(good) as unknown as Record<string, Record<string, unknown>>;
    bad['project']!['slug'] = 'Not A Slug';
    bad['stack']!['pack'] = 'rails';
    bad['extra'] = {};
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    const text = r.issues.map((i) => i.message).join('\n');
    expect(text).toMatch(/\/project\/slug must match pattern/);
    expect(text).toMatch(/\/stack\/pack must be equal to one of the allowed values: \["node-web"/);
    expect(text).toMatch(/additional properties \(extra\)/);
  });

  it('validates partial drafts and discovery turns', () => {
    expect(validateDraft({ stack: { pack: 'node-web' } }).ok).toBe(true);
    expect(validateDraft({ stack: { pack: 'cobol' } }).ok).toBe(false);
    const turn = {
      draftSpec: { platform: 'web' },
      questions: [
        {
          key: 'deploy.target',
          question: 'Where does it run?',
          impact: 8,
          options: [
            { value: 'vps-tailscale', label: 'VPS', recommended: true },
            { value: 'docker-host', label: 'Docker', recommended: false },
          ],
        },
      ],
      done: false,
    };
    expect(validateDiscoveryTurn(turn).issues).toEqual([]);
    expect(validateDiscoveryTurn({ ...turn, draftSpec: { platform: 'mainframe' } }).ok).toBe(false);
    expect(
      validateDiscoveryTurn({ ...turn, questions: [{ ...turn.questions[0], options: [] }] }).ok,
    ).toBe(false);
    expect(validateAgainst({ $id: 'x-test', type: 'string' }, 1).ok).toBe(false);
  });
});

describe('semantics', () => {
  const base = (): IncubatorSpec =>
    completeSpec({ stack: { pack: 'node-web' }, project: { name: 'Shop' } }).spec;

  it('reports cross-field violations with stable codes', () => {
    const s = base();
    s.platform = 'cli';
    s.stack.framework = 'fastapi';
    s.stack.packageManager = 'uv';
    s.stack.database = 'mariadb';
    s.lanes.environments = ['local', 'prod'];
    s.lanes.branches.prod = 'main';
    s.lanes.workLanes = [];
    s.testing.profiles = ['full'];
    s.testing.home = 'paired-repo';
    s.security.scanners = ['semgrep'];
    s.security.centralRig = { enabled: true, repo: '' };
    s.tracker = { type: 'leantime' };
    s.agents.also = ['claude'];
    s.intent.coreFeatures = [
      { id: 'health', summary: 'x', lane: 'enhancement/new' },
      { id: 'health', summary: 'y', lane: 'enhancement/new' },
    ];
    s.decisions = [...s.decisions, s.decisions[0]!];
    const codes = validateSemantics(s).map((i) => i.code);
    for (const code of [
      'platform_pack',
      'pack_framework',
      'pack_package_manager',
      'mariadb_only_wp',
      'fixed_lanes',
      'branches_distinct',
      'work_lanes',
      'profiles_min',
      'paired_name',
      'scanners_fixed',
      'central_rig_repo',
      'leantime_config',
      'agents_also',
      'feature_ids',
      'feature_reserved',
      'decision_keys',
    ]) {
      expect(codes).toContain(code);
    }
  });

  it('checks library and WordPress specifics', () => {
    const lib = completeSpec({ stack: { pack: 'node-lib' }, project: { name: 'Lib' } }).spec;
    lib.stack.database = 'postgres';
    lib.deploy.target = 'docker-host';
    lib.testing.e2e = 'playwright';
    expect(validateSemantics(lib).map((i) => i.code)).toEqual([
      'lib_database',
      'deploy_class',
      'lib_e2e',
    ]);
    const wp = completeSpec({ platform: 'wordpress-theme', project: { name: 'Theme' } }).spec;
    wp.stack.framework = 'wordpress-plugin';
    wp.stack.database = 'postgres';
    expect(validateSemantics(wp).map((i) => i.code)).toEqual(['wp_database', 'wp_theme_framework']);
    const paired = completeSpec({
      project: { name: 'Shop', slug: 'shop' },
      testing: { home: 'paired-repo', pairedRepo: { name: 'shop' } },
    }).spec;
    expect(validateSemantics(paired).map((i) => i.code)).toEqual(['paired_name']);
  });
});

describe('serialization and hashing', () => {
  it('orders keys by schema and is stable', () => {
    const { spec } = completeSpec({ project: { name: 'Shop' } });
    const reverse = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverse)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, x]) => [k, reverse(x)]),
            )
          : v;
    const shuffled = reverse(spec) as IncubatorSpec;
    expect(Object.keys(shuffled)[0]).toBe('decisions');
    expect(serializeSpec(shuffled)).toBe(serializeSpec(spec));
    expect(
      serializeSpec(spec).startsWith(
        '{\n  "incubatorVersion": "1.0",\n  "mode": "greenfield",\n  "project"',
      ),
    ).toBe(true);
    expect(serializeSpec({ zeta: 1, alpha: 2 })).toBe('{\n  "alpha": 2,\n  "zeta": 1\n}\n');
    expect(specHash(shuffled)).toBe(specHash(spec));
  });
});

describe('path helpers', () => {
  it('get, set, diff, merge and cover', () => {
    const o: Record<string, unknown> = {};
    setAt(o, 'a.b.c', 1);
    setAt(o, 'a.x', [1]);
    expect(getAt(o, 'a.b.c')).toBe(1);
    expect(getAt(o, 'a.x.y')).toBeUndefined();
    expect(changedPaths({ a: { b: 1, c: [1] } }, { a: { b: 2, c: [1], d: { e: 1 } } })).toEqual([
      'a.b',
      'a.d.e',
    ]);
    expect(deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 3, d: undefined } })).toEqual({
      a: { b: 3, c: 2 },
    });
    expect(deepMerge(1, undefined)).toBe(1);
    expect(covers('stack', 'stack.pack')).toBe(true);
    expect(covers('stack', 'stackx')).toBe(false);
  });
});

describe('version and generated types', () => {
  it('accepts only the current version', () => {
    expect(isSupportedSpecVersion('1.0')).toBe(true);
    expect(isSupportedSpecVersion('0.9')).toBe(false);
  });

  it('types.gen.ts matches the schemas', async () => {
    const gen = (await import(new URL('../scripts/gen-types.mjs', import.meta.url).href)) as {
      generate: () => Promise<string>;
    };
    expect(await gen.generate()).toBe(
      readFileSync(new URL('./types.gen.ts', import.meta.url), 'utf8'),
    );
  });
});
