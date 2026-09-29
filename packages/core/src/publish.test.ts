import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeExec, ToolError } from '@incubator/runtime';
import { completeSpec, type IncubatorSpec } from '@incubator/spec';
import type { GitHubMethod } from '@incubator/git';
import { FAKE_GITHUB_TOKEN, fakePublishEngine } from './testing.js';

const combos = path.resolve(import.meta.dirname, '../../templates/fixtures/combos');
function spec(combo: string, over: Record<string, unknown> = {}): IncubatorSpec {
  const draft = JSON.parse(readFileSync(path.join(combos, `${combo}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
  const project = { ...(draft['project'] as object), owner: { type: 'user', login: 'octo' } };
  return completeSpec({ ...draft, project, ...over }).spec;
}

async function runToEnd(h: ReturnType<typeof fakePublishEngine>, runId: string, maxResumes = 3) {
  let s = h.engine.state(runId);
  for (let i = 0; i <= maxResumes && !s.done; i++) {
    try {
      s =
        i === 0
          ? await h.engine.advance(runId, undefined as never)
          : await h.engine.resume(runId, undefined as never);
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
    }
    s = h.engine.state(runId);
  }
  return s;
}

async function remoteLog(h: ReturnType<typeof fakePublishEngine>, name: string, branch: string) {
  const r = await nodeExec.run(
    'git',
    ['--git-dir', path.join(h.github.root, 'octo', `${name}.git`), 'rev-list', '--count', branch],
    { timeoutMs: 10_000 },
  );
  return Number(r.stdout.trim());
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

describe('publish', () => {
  it('runs SCAFFOLD → VERIFY → PUBLISH → HANDOFF → DONE with the TDD call sequence', async () => {
    const h = fakePublishEngine();
    const runId = h.engine.startFromSpec(spec('node-lib.in-repo.package-release'), {
      kind: 'scaffold',
      surface: 'test',
    });
    const s = await runToEnd(h, runId, 0);
    expect(s.state).toBe('DONE');
    expect(h.github.calls.map((c) => c.method)).toMatchInlineSnapshot(`
      [
        "tokenInfo",
        "getRepo",
        "getRepo",
        "createRepo",
        "getBranchSha",
        "createBranch",
        "setBranchProtection",
        "setBranchProtection",
        "ensureLabels",
        "ensureVariables",
      ]
    `);
    const repo = h.github.repos.get('octo/tallyho')!;
    expect(repo.description).toContain(`incubator-run:${runId}`);
    expect(Object.keys(repo.protection)).toEqual(['main', 'production']);
    expect(repo.labels.map((l) => l.name)).toContain('lane:security');
    expect(await h.github.getBranchSha({ owner: 'octo', name: 'tallyho' }, 'production')).toBe(
      await h.github.getBranchSha({ owner: 'octo', name: 'tallyho' }, 'main'),
    );
    const summary = h.engine.publishSummary(runId)!;
    expect(summary).toMatchObject({
      repo: 'https://github.com/octo/tallyho',
      variablesCreated: [],
      warnings: [],
    });
    expect(summary.secretsToSet.map((x) => x.name)).toEqual(['NPM_TOKEN']);
    const msg = await nodeExec.run(
      'git',
      [
        '--git-dir',
        path.join(h.github.root, 'octo', 'tallyho.git'),
        'log',
        '-1',
        '--format=%B%n%an <%ae>%n%ad',
        '--date=iso-strict',
        'main',
      ],
      { timeoutMs: 10_000 },
    );
    expect(msg.stdout).toMatch(
      /^chore: scaffold tallyho from incubator\.json\n\nIncubator-Spec: sha256:[0-9a-f]{64}\nIncubator-Packs: base@1\.0\.0, stack\/node-lib@1\.0\.0, deploy\/package-release@1\.0\.0, test-home\/in-repo@1\.0\.0\nIncubator-Run: /,
    );
    expect(msg.stdout).toContain('Incubator Test <test@example.invalid>');
    expect(msg.stdout).toContain('2026-05-01T12:00:00');
    // The workspace is removed after publishing.
    expect(() => readdirSync(path.join(h.store.runDir(runId), 'workspace'))).toThrow();
  });

  it('never leaks the token into the run directory or the log', async () => {
    const h = fakePublishEngine();
    const runId = h.engine.startFromSpec(spec('node-lib.in-repo.package-release'), {
      kind: 'scaffold',
      surface: 'test',
      keep: true,
    });
    await runToEnd(h, runId, 0);
    for (const f of filesUnder(h.home)) {
      if (f.includes(`${path.sep}.git${path.sep}`)) continue;
      expect(readFileSync(f, 'utf8'), f).not.toContain(FAKE_GITHUB_TOKEN);
    }
    expect(JSON.stringify(h.sink.records)).not.toContain(FAKE_GITHUB_TOKEN);
  });

  const githubFaults: GitHubMethod[] = [
    'tokenInfo',
    'getRepo',
    'createRepo',
    'getBranchSha',
    'createBranch',
    'setBranchProtection',
    'ensureLabels',
    'ensureVariables',
  ];
  const gitFaults = ['init', 'addAll', 'chmodX', 'commit', 'push'] as const;
  const points = [
    ...githubFaults.flatMap((m) =>
      (['before', 'after'] as const).map((when) => ({ kind: 'github' as const, m, when })),
    ),
    ...gitFaults.flatMap((m) =>
      (['before', 'after'] as const).map((when) => ({ kind: 'git' as const, m, when })),
    ),
    { kind: 'verify' as const, m: 'verify', when: 'before' as const },
  ];

  it.each(points)(
    'resumes cleanly after a $kind failure $when $m, without duplicate effects',
    async ({ kind, m, when }) => {
      const h = fakePublishEngine();
      if (kind === 'github') h.github.failAt = { method: m, when };
      else if (kind === 'git') h.gitFaults.failAt = { method: m as never, when };
      else h.verifyFaults.failNext = true;
      const runId = h.engine.startFromSpec(spec('node-lib.in-repo.package-release'), {
        kind: 'scaffold',
        surface: 'test',
      });
      const s = await runToEnd(h, runId, 2);
      expect(s.state).toBe('DONE');
      expect(h.github.repos.size).toBe(1);
      expect(await remoteLog(h, 'tallyho', 'main')).toBe(1);
      expect(await h.github.getBranchSha({ owner: 'octo', name: 'tallyho' }, 'production')).toBe(
        await h.github.getBranchSha({ owner: 'octo', name: 'tallyho' }, 'main'),
      );
      const created = h.github.calls.filter((c) => c.method === 'createRepo').length;
      expect(created).toBe(m === 'createRepo' && when === 'before' ? 2 : 1);
      const repo = h.github.repos.get('octo/tallyho')!;
      expect(new Set(repo.labels.map((l) => l.name)).size).toBe(repo.labels.length);
      const warned = Object.entries(h.engine.state(runId).steps).filter(
        ([, v]) => v.status === 'warn',
      );
      // Configure steps are best effort: an injected failure there is a warning, not a stop.
      if (['setBranchProtection', 'ensureLabels', 'ensureVariables'].includes(m))
        expect(warned.length).toBe(1);
      else expect(warned).toEqual([]);
    },
  );

  it('publishes a paired tests repository next to the app', async () => {
    const h = fakePublishEngine();
    const runId = h.engine.startFromSpec(spec('node-lib.paired-repo.package-release'), {
      kind: 'scaffold',
      surface: 'test',
    });
    const s = await runToEnd(h, runId, 0);
    expect(s.state).toBe('DONE');
    expect([...h.github.repos.keys()].sort()).toEqual(['octo/shipnote', 'octo/shipnote-tests']);
    expect(await remoteLog(h, 'shipnote-tests', 'main')).toBe(1);
    const summary = h.engine.publishSummary(runId)!;
    expect(summary.pairedRepo).toBe('https://github.com/octo/shipnote-tests');
    expect(summary.secretsToSet).toContainEqual(
      expect.objectContaining({
        name: 'APP_REPO_READ_TOKEN',
        repo: 'https://github.com/octo/shipnote-tests',
      }),
    );
  });

  it('parks on a taken name and on a failed verify, then resumes', async () => {
    const h = fakePublishEngine();
    await h.github.createRepo({
      owner: 'octo',
      name: 'tallyho',
      ownerType: 'user',
      visibility: 'private',
      description: 'someone else',
    });
    const runId = h.engine.startFromSpec(spec('node-lib.in-repo.package-release'), {
      kind: 'scaffold',
      surface: 'test',
    });
    let s = await h.engine.advance(runId, undefined as never);
    expect(s.state).toBe('PARKED');
    expect(s.parked).toMatchObject({ state: 'SCAFFOLD', reason: 'name_taken' });
    h.github.repos.delete('octo/tallyho');
    s = await h.engine.resume(runId, undefined as never);
    expect(s.state).toBe('DONE');

    let ok = false;
    const v = fakePublishEngine({
      verify: () => ({ ok, summary: ok ? 'fine' : 'unit: 2 failed' }),
    });
    const run2 = v.engine.startFromSpec(spec('node-lib.in-repo.package-release'), {
      kind: 'scaffold',
      surface: 'test',
    });
    s = await v.engine.advance(run2, undefined as never);
    expect(s.parked).toMatchObject({ state: 'VERIFY', reason: 'verify_failed' });
    expect(v.github.calls.some((c) => c.method === 'createRepo')).toBe(false);
    ok = true;
    expect((await v.engine.resume(run2, undefined as never)).state).toBe('DONE');
  });

  it('warns instead of failing when branch protection is unavailable', async () => {
    const h = fakePublishEngine({ github: { protectionUnsupported: true } });
    const runId = h.engine.startFromSpec(spec('node-lib.in-repo.package-release'), {
      kind: 'scaffold',
      surface: 'test',
    });
    expect((await runToEnd(h, runId, 0)).state).toBe('DONE');
    expect(h.engine.publishSummary(runId)!.warnings.join('\n')).toContain('GitHub Pro');
  });

  it('scaffold-only runs write to --out and stop', async () => {
    const h = fakePublishEngine();
    const out = path.join(h.home, 'out', 'tallyho');
    const runId = h.engine.startFromSpec(spec('node-lib.in-repo.package-release'), {
      kind: 'scaffold',
      surface: 'test',
      out,
    });
    expect((await runToEnd(h, runId, 0)).state).toBe('DONE');
    expect(readFileSync(path.join(out, 'incubator.json'), 'utf8')).toContain('"slug": "tallyho"');
    expect(h.github.calls).toEqual([]);
  });
});
