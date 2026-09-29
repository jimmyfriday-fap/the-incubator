// Live publish against a sandbox GitHub owner. Runs only with INCUBATOR_LIVE=1 and
// INCUBATOR_LIVE_GH_OWNER (a user or org you are happy to create throwaway repositories in); the
// token comes from the usual chain (keychain, gh, GITHUB_TOKEN). The repository is left in place
// for inspection; delete it by hand (the token needs delete_repo to do it automatically).
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FixedClock,
  Logger,
  MemorySink,
  OsKeychain,
  SecretString,
  nodeExec,
  systemClock,
} from '@incubator/runtime';
import { OctokitGitHub, createGitOps, resolveGitHubToken } from '@incubator/git';
import { LeantimeTracker } from '@incubator/tracker';
import { completeSpec } from '@incubator/spec';
import { Engine } from './engine.js';
import { RunStore } from './store.js';

const owner = process.env['INCUBATOR_LIVE_GH_OWNER'];
const ownerType = process.env['INCUBATOR_LIVE_GH_OWNER_TYPE'] === 'org' ? 'org' : 'user';

describe.skipIf(process.env['INCUBATOR_LIVE'] !== '1' || !owner)(
  'live publish (sandbox owner)',
  () => {
    it('publishes a node-lib repository with both branches, labels and variables', async () => {
      const home = mkdtempSync(path.join(os.tmpdir(), 'incubator-live-'));
      const log = new Logger([new MemorySink()]);
      const engine = new Engine({
        store: new RunStore(systemClock, home),
        clock: systemClock,
        log,
        llm: { select: () => Promise.reject(new Error('no LLM needed')) },
        publish: {
          resolveToken: () =>
            resolveGitHubToken({ keychain: new OsKeychain(), exec: nodeExec, env: process.env }),
          github: (t) => new OctokitGitHub(t),
          git: createGitOps(nodeExec),
          verify: () => Promise.resolve({ ok: true, summary: 'skipped in the live publish test' }),
        },
      });
      const combo = path.resolve(
        import.meta.dirname,
        '../../templates/fixtures/combos/node-lib.in-repo.package-release.json',
      );
      const draft = JSON.parse(readFileSync(combo, 'utf8')) as Record<
        string,
        Record<string, unknown>
      >;
      const slug = `incubator-live-${Date.now().toString(36)}`;
      const spec = completeSpec({
        ...draft,
        project: {
          ...draft['project'],
          slug,
          name: slug,
          owner: { type: ownerType, login: owner },
          visibility: 'private',
        },
      }).spec;
      const runId = engine.startFromSpec(spec, { kind: 'scaffold', surface: 'test' });
      const s = await engine.advance(runId, undefined as never);
      expect(s.state).toBe('DONE');
      const summary = engine.publishSummary(runId)!;
      expect(summary.repo).toBe(`https://github.com/${owner}/${slug}`);
      const gh = new OctokitGitHub(
        (await resolveGitHubToken({
          keychain: new OsKeychain(),
          exec: nodeExec,
          env: process.env,
        }))!.token,
      );
      expect(await gh.getBranchSha({ owner: owner!, name: slug }, 'production')).toBe(
        summary.commit,
      );
    });
  },
);

describe.skipIf(
  process.env['INCUBATOR_LIVE'] !== '1' || !process.env['INCUBATOR_LIVE_LEANTIME_URL'],
)('live Leantime', () => {
  it('creates a tagged ticket once and moves it', async () => {
    const t = new LeantimeTracker({
      baseUrl: process.env['INCUBATOR_LIVE_LEANTIME_URL']!,
      projectId: Number(process.env['INCUBATOR_LIVE_LEANTIME_PROJECT'] ?? '1'),
      apiKey: new SecretString(process.env['INCUBATOR_LEANTIME_TOKEN'] ?? ''),
      statusMap: JSON.parse(
        process.env['INCUBATOR_LIVE_LEANTIME_STATUS_MAP'] ??
          '{"TAGGED_TO_RELEASE":3,"ENRICHMENT_IN_PROGRESS":4}',
      ) as Record<string, number>,
    });
    const id = `F-live-${new FixedClock(new Date().toISOString()).now().getTime().toString(36)}`;
    const first = await t.ensureTicket({
      id,
      title: 'Incubator live test',
      lane: 'testing',
      description: 'created by the live test',
    });
    expect(first.created).toBe(true);
    expect(
      await t.ensureTicket({ id, title: 'Incubator live test', lane: 'testing', description: 'x' }),
    ).toEqual({ ref: first.ref, created: false });
    await t.transition(first.ref, 'ENRICHMENT_IN_PROGRESS');
  });
});
