import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ToolError, nodeExec, sha256Hex } from '@incubator/runtime';
import type { GitHubMethod } from '@incubator/git';
import type { GitOps } from '@incubator/git';
import { completeSpec } from '@incubator/spec';
import { render, writeTree } from '@incubator/templates';
import { parseGitHubRef } from './adopt.js';
import { DefaultsPrompter } from './prompter.js';
import { fakePublishEngine } from './testing.js';

const fixtures = path.resolve(import.meta.dirname, '../../analyzer/fixtures');
const git = (args: string[], cwd: string) => nodeExec.run('git', args, { cwd, timeoutMs: 30_000 });

function hashes(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(path.join(dir, rel)).sort()) {
    if (name === '.git') continue;
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(path.join(dir, r)).isDirectory()) Object.assign(out, hashes(dir, r));
    else out[r] = sha256Hex(readFileSync(path.join(dir, r)));
  }
  return out;
}

/** Puts a fixture into a git repository whose origin is a repo on the fake GitHub. */
async function seed(
  h: ReturnType<typeof fakePublishEngine>,
  name: string,
  from: string | ((dir: string) => Promise<void>),
) {
  const ref = { owner: 'octo', name };
  await h.github.createRepo({
    ...ref,
    ownerType: 'user',
    visibility: 'private',
    description: 'existing project',
  });
  const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'adopt-src-')), name);
  if (typeof from === 'string')
    cpSync(from, dir, { recursive: true, filter: (s) => !s.endsWith('expected-gap-report.json') });
  else await from(dir);
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['add', '-A'],
    ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'existing'],
    ['remote', 'add', 'origin', h.github.remoteUrl(ref)],
    ['push', '-q', 'origin', 'HEAD:refs/heads/main'],
  ])
    expect((await git(args, dir)).code).toBe(0);
  return { ref, dir };
}

async function adopt(
  h: ReturnType<typeof fakePublishEngine>,
  repo: string,
  ref: { owner: string; name: string },
) {
  const runId = h.engine.start({ kind: 'adopt', repo, repoRef: ref, yes: true, surface: 'test' });
  const s = await h.engine.advance(runId, new DefaultsPrompter());
  return { runId, s };
}

describe('adopt', () => {
  it('parses GitHub remotes', () => {
    expect(parseGitHubRef('https://github.com/octo/app.git')).toEqual({
      owner: 'octo',
      name: 'app',
    });
    expect(parseGitHubRef('git@github.com:octo/app.git')).toEqual({ owner: 'octo', name: 'app' });
    expect(parseGitHubRef('https://gitlab.com/octo/app')).toBeNull();
  });

  it.each(['bare-node', 'wp-plugin', 'python-service'])(
    '%s: opens a PR that only adds files',
    async (fixture) => {
      const h = fakePublishEngine();
      const { ref, dir } = await seed(h, fixture, path.join(fixtures, fixture));
      const before = hashes(dir);
      const { runId, s } = await adopt(h, h.github.remoteUrl(ref), ref);
      expect(s.state).toBe('DONE');
      const summary = h.engine.adoptSummary(runId);
      expect(summary.pr).toEqual({ number: 1, url: `https://github.com/octo/${fixture}/pull/1` });
      const pr = h.github.repos.get(`octo/${fixture}`)!.prs[0]!;
      expect(pr).toMatchObject({
        head: 'incubator/adopt-20260501',
        base: 'main',
        title: 'Adopt the Incubator canonical pattern',
      });
      expect(pr.body).toContain('# Incubator gap report');
      expect(pr.body).toContain('❌ missing');
      // No existing file is modified: the branch diff is additions only, and the source is untouched.
      const bare = path.join(h.github.root, 'octo', `${fixture}.git`);
      const diff = await git(
        ['--git-dir', bare, 'diff', '--name-status', 'main..incubator/adopt-20260501'],
        dir,
      );
      const statuses = new Set(
        diff.stdout
          .trim()
          .split('\n')
          .map((l) => l.split('\t')[0]),
      );
      expect([...statuses]).toEqual(['A']);
      expect(diff.stdout).toContain('CLAUDE.md');
      expect(hashes(dir)).toEqual(before);
      expect((await git(['--git-dir', bare, 'rev-parse', 'main'], dir)).stdout.trim()).toBe(
        (await git(['rev-parse', 'HEAD'], dir)).stdout.trim(),
      );
    },
  );

  it('proposes conflicting files next to the originals', async () => {
    const h = fakePublishEngine();
    const { ref } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
    await adopt(h, h.github.remoteUrl(ref), ref);
    const bare = path.join(h.github.root, 'octo', 'bare-node.git');
    const ls = await git(
      ['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'incubator/adopt-20260501'],
      fixtures,
    );
    expect(ls.stdout).toContain('package.json.incubator-proposed');
    const show = await git(
      ['--git-dir', bare, 'show', 'incubator/adopt-20260501:package.json'],
      fixtures,
    );
    expect(show.stdout).toBe(readFileSync(path.join(fixtures, 'bare-node/package.json'), 'utf8'));
  });

  it('an already compliant repository gives an empty delta and no pull request', async () => {
    const h = fakePublishEngine();
    const spec = completeSpec(
      JSON.parse(readFileSync(path.join(fixtures, 'compliant/incubator.json'), 'utf8')) as never,
    ).spec;
    const { ref } = await seed(h, 'tallyho', async (dir) => {
      writeTree(await render(spec), dir, { mode: 'fresh' });
    });
    const { runId, s } = await adopt(h, h.github.remoteUrl(ref), ref);
    expect(s.state).toBe('DONE');
    expect(h.engine.adoptSummary(runId)).toMatchObject({ compliant: true });
    expect(h.github.repos.get('octo/tallyho')!.prs).toEqual([]);
    expect(h.github.calls.some((c) => c.method === 'openPr')).toBe(false);
  });

  it('adopts a local path without touching it, and can stop before publishing', async () => {
    const h = fakePublishEngine();
    const { ref, dir } = await seed(h, 'python-service', path.join(fixtures, 'python-service'));
    const before = hashes(dir);
    const runId = h.engine.start({
      kind: 'adopt',
      repo: dir,
      repoRef: ref,
      yes: true,
      noPublish: true,
      surface: 'test',
    });
    expect((await h.engine.advance(runId, new DefaultsPrompter())).state).toBe('DONE');
    expect(hashes(dir)).toEqual(before);
    expect(h.github.calls.some((c) => c.method === 'openPr')).toBe(false);
    expect(h.engine.adoptSummary(runId).report).toContain(
      'python-service (fastapi, service; high confidence)',
    );
  });

  it('parks when there is no GitHub origin, and on a non-git path', async () => {
    const h = fakePublishEngine();
    const { dir } = await seed(h, 'wp-plugin', path.join(fixtures, 'wp-plugin'));
    expect((await git(['remote', 'remove', 'origin'], dir)).code).toBe(0);
    const runId = h.engine.start({ kind: 'adopt', repo: dir, yes: true, surface: 'test' });
    expect((await h.engine.advance(runId, new DefaultsPrompter())).parked).toMatchObject({
      reason: 'no_github_origin',
    });
    const plain = mkdtempSync(path.join(os.tmpdir(), 'plain-'));
    const run2 = h.engine.start({ kind: 'adopt', repo: plain, yes: true, surface: 'test' });
    expect((await h.engine.advance(run2, new DefaultsPrompter())).parked).toMatchObject({
      reason: 'not_git',
    });
  });
});

describe('adopt resumes after a crash at any step (ADR-010, ADR-020)', () => {
  const gitPoints = (
    ['checkoutNewBranch', 'currentBranch', 'addAll', 'commit', 'diffNameStatus', 'push'] as const
  ).flatMap((m) =>
    (['before', 'after'] as const).map((when) => ({ kind: 'git' as const, m, when })),
  );
  const githubPoints = (['getRepo', 'openPr'] as const).flatMap((m) =>
    (['before', 'after'] as const).map((when) => ({ kind: 'github' as const, m, when })),
  );

  it.each([...gitPoints, ...githubPoints])(
    'one commit, one PR, additions only after a $kind failure $when $m',
    async ({ kind, m, when }) => {
      const h = fakePublishEngine();
      const { ref, dir } = await seed(h, 'bare-node', path.join(fixtures, 'bare-node'));
      const before = hashes(dir);
      if (kind === 'git') h.gitFaults.failAt = { method: m as keyof GitOps, when };
      else h.github.failAt = { method: m as GitHubMethod, when };
      const runId = h.engine.start({
        kind: 'adopt',
        repo: h.github.remoteUrl(ref),
        repoRef: ref,
        yes: true,
        surface: 'test',
      });
      let s = h.engine.state(runId);
      for (let i = 0; i < 4 && !s.done; i++) {
        try {
          s =
            i === 0
              ? await h.engine.advance(runId, new DefaultsPrompter())
              : await h.engine.resume(runId, new DefaultsPrompter());
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
        }
        s = h.engine.state(runId);
      }
      expect(s.state).toBe('DONE');
      // Exactly one pull request, even when the crash hit right after GitHub created it.
      expect(h.github.repos.get('octo/bare-node')!.prs).toHaveLength(1);
      const bare = path.join(h.github.root, 'octo', 'bare-node.git');
      const count = await git(
        ['--git-dir', bare, 'rev-list', '--count', 'main..incubator/adopt-20260501'],
        dir,
      );
      expect(count.stdout.trim()).toBe('1');
      const diff = await git(
        ['--git-dir', bare, 'diff', '--name-status', 'main..incubator/adopt-20260501'],
        dir,
      );
      expect(
        new Set(
          diff.stdout
            .trim()
            .split('\n')
            .map((l) => l.split('\t')[0]),
        ),
      ).toEqual(new Set(['A']));
      expect(hashes(dir)).toEqual(before);
    },
  );
});
