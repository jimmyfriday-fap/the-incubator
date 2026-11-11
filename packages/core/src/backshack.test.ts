import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capabilities } from '@incubator/llm';
import { nodeExec, type Exec } from '@incubator/runtime';
import { completeSpec, type IncubatorSpec } from '@incubator/spec';
import {
  BACKSHACK_TOKEN_CEILING,
  RECOMMENDATION_FILE,
  backshackFit,
  backshackPaths,
  backshackTargets,
  recommendationYaml,
  stageRunGuides,
} from './backshack.js';
import type { IncubatorConfig } from './config.js';
import { validateChecks } from './checks.js';
import { handoffPrompt } from './handoff.js';
import { DefaultsPrompter } from './prompter.js';
import { enhanceFixtureDir, fakePublishEngine, seedExistingRepo } from './testing.js';

const fakeAgent = path.resolve(import.meta.dirname, '../fixtures/handoff/fake-agent.mjs');
const combos = path.resolve(import.meta.dirname, '../../templates/fixtures/combos');
const analyzerFixtures = path.resolve(import.meta.dirname, '../../analyzer/fixtures');
const agentCaps: Capabilities = {
  installed: true,
  path: process.execPath,
  version: '1',
  flags: {
    printMode: [fakeAgent, '-p'],
    streamJson: ['--output-format', 'stream-json'],
    allowedTools: '--allowedTools',
  },
  stdinPrompt: true,
  eligible: { discovery: true, analysis: true, handoff: true },
  reasons: [],
};
const REQUEST = 'Kitchen staff need to export the orders list as a CSV file.';
const CONTRACT =
  '# Backshack Build Contract v1.0\n\n#### 5. Conformance check\nRun from the plugin root.\n';

const git = (args: string[], cwd: string) => nodeExec.run('git', args, { cwd, timeoutMs: 30_000 });
const out = async (args: string[], cwd: string) => (await git(args, cwd)).stdout.trim();

beforeEach(() => {
  const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'gitcfg ')), 'gitconfig');
  writeFileSync(cfg, '[user]\n\tname = Owner Person\n\temail = owner@example.invalid\n');
  vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('FAKE_AGENT_MODE', 'edit');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** The prompts every agent launch received on stdin. */
function recordingExec(prompts: string[]): Exec {
  return {
    ...nodeExec,
    run: (bin, args, opts) => {
      if (typeof opts?.stdin === 'string') prompts.push(opts.stdin);
      return nodeExec.run(bin, args, opts);
    },
  };
}

/** A generator checkout with the contract, unless asked not to have one. */
function generatorRepo(contract: string | null = CONTRACT): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'backshack generator '));
  mkdirSync(path.join(dir, 'docs'));
  if (contract !== null) writeFileSync(path.join(dir, 'docs', 'BACKSHACK_CONTRACT.md'), contract);
  return dir;
}

async function backshackHarness(opts: { contract?: string | null } = {}) {
  const prompts: string[] = [];
  const config: IncubatorConfig = {};
  const h = fakePublishEngine({
    handoff: { exec: recordingExec(prompts), probe: () => Promise.resolve(agentCaps) },
    llm: { dir: enhanceFixtureDir('export-orders') },
    config: () => config,
  });
  // The seeded repository stands in for backshack-dev: a clone whose origin has main.
  const { ref, dir } = await seedExistingRepo(
    h.github,
    'bare-node',
    path.join(analyzerFixtures, 'bare-node'),
  );
  const generator = generatorRepo(opts.contract === undefined ? CONTRACT : opts.contract);
  config.backshack = { devRepo: dir, generatorRepo: generator };
  return { h, ref, devRepo: dir, generator, prompts, config };
}

describe('the Backshack fit and decision (ADR-030)', () => {
  it('fills a slug, prefix, rack and handoff schema from the tool name, and refuses ones that cannot be used', () => {
    expect(backshackFit({ toolName: 'The Scope' })).toEqual({
      toolName: 'The Scope',
      toolSlug: 'the-scope',
      prefix: 'scope',
      rack: 'new',
      stages: [],
      aiPipes: [],
      handoffSchema: 'backshack.scope-handoff.v1',
    });
    expect(() => backshackFit({ toolName: '' })).toThrow(/name the Backshack tool/);
    expect(() => backshackFit({ toolName: 'X', toolSlug: '../etc' })).toThrow(/slug/);
    expect(() => backshackFit({ toolName: 'X Tool', prefix: 'DROP TABLE' })).toThrow(/prefix/);
  });

  it('writes the decision as YAML whose values are all quoted', () => {
    const yaml = recommendationYaml({
      target: 'backshack',
      rationale: ['It is a staged AI workflow: "for members"'],
      fit: backshackFit({ toolName: 'COI Tracker', stages: ['intake', 'review'] }),
      decidedAt: '2026-11-02T12:00:00.000Z',
    });
    expect(yaml).toBe(
      [
        'target: "backshack"',
        'rationale:',
        '  - "It is a staged AI workflow: \\"for members\\""',
        'backshack_fit:',
        '  tool_name: "COI Tracker"',
        '  tool_slug: "coi-tracker"',
        '  prefix: "coi_tracker"',
        '  rack: "new"',
        '  stages:',
        '    - "intake"',
        '    - "review"',
        '  ai_pipes: []',
        '  handoff_schema: "backshack.coi-tracker-handoff.v1"',
        'decided_at: "2026-11-02T12:00:00.000Z"',
        '',
      ].join('\n'),
    );
  });

  it('needs full configured paths, and says which', () => {
    expect(backshackPaths({}, '/home')).toMatchObject({ ok: false });
    const p = backshackPaths({ backshack: { devRepo: 'rel', generatorRepo: 'rel' } }, '/home');
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.problems.join(' ')).toMatch(/backshack\.devRepo must be a full path/);
  });
});

describe('the files a Backshack tool run builds in (ADR-030)', () => {
  it('are the tool package and its shim, whatever the scan of the repository matches', () => {
    expect(backshackTargets('order-export')).toEqual([
      'wp-content/plugins/backshack-datalake/src/Tools/order-export/',
      'wp-content/plugins/backshack-datalake/src/tools-auto/order-export.php',
    ]);
  });
});

describe('staging the run guides in a Backshack worktree (ADR-030)', () => {
  it('copies the guides, skips state, hides them from git and keeps files already there', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'bs-guides-'));
    try {
      const from = path.join(root, 'clone');
      const to = path.join(root, 'worktree');
      mkdirSync(path.join(from, '.incubator', 'tickets'), { recursive: true });
      mkdirSync(path.join(from, '.incubator', 'state'), { recursive: true });
      writeFileSync(path.join(from, '.incubator', 'tickets', 'E-a.json'), '{"state":"NEW"}');
      writeFileSync(path.join(from, '.incubator', 'state', 'active-ticket'), 'E-a');
      mkdirSync(to);
      stageRunGuides(from, to);
      const ticket = path.join(to, '.incubator', 'tickets', 'E-a.json');
      expect(readFileSync(ticket, 'utf8')).toBe('{"state":"NEW"}');
      expect(existsSync(path.join(to, '.incubator', 'state'))).toBe(false);
      expect(readFileSync(path.join(to, '.incubator', '.gitignore'), 'utf8')).toBe('*\n');
      // A resumed run keeps what the agent advanced.
      writeFileSync(ticket, '{"state":"READY_FOR_TEST"}');
      stageRunGuides(from, to);
      expect(readFileSync(ticket, 'utf8')).toBe('{"state":"READY_FOR_TEST"}');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the contract in the coding prompt (ADR-030)', () => {
  const plan = '# Plan\n\n**Step 1:** do it';

  it('is never in the prompt of any other stack', () => {
    for (const p of [handoffPrompt(plan), handoffPrompt(plan, { checks: ['node --check x.js'] })]) {
      expect(p).not.toContain('Backshack Build Contract');
      expect(p).not.toContain('Section 5');
    }
  });

  it('is included verbatim, after the plan, with the instruction to run Section 5', () => {
    const p = handoffPrompt(plan, { checks: [] }, { contract: CONTRACT });
    expect(p).toContain(CONTRACT.trim());
    expect(p).toContain("Run the contract's Section 5 conformance check before declaring done");
    expect(p.indexOf('**Step 1:** do it')).toBeLessThan(p.indexOf(CONTRACT.trim()));
    expect(handoffPrompt(plan, undefined, { contract: CONTRACT })).toContain(CONTRACT.trim());
  });
});

describe('a backshack-tool run (ADR-030)', () => {
  it('builds in a fresh backshack-dev worktree on its own branch, with the contract, committed only', async () => {
    const { h, ref, devRepo, prompts } = await backshackHarness();
    const mainBefore = await out(['rev-parse', 'origin/main'], devRepo);
    const prepared = await h.engine.backshackPrepare({
      narrative: REQUEST,
      fit: { toolName: 'Order Export' },
      rationale: ['A staged AI workflow for paying members.'],
      surface: 'test',
    });
    expect(prepared.branch).toBe('incubator/backshack-order-export');
    expect(prepared.dir).toBe(path.join(h.home, 'worktrees', 'backshack-order-export'));
    expect(await out(['rev-parse', '--abbrev-ref', 'HEAD'], prepared.dir)).toBe(prepared.branch);
    expect(await out(['rev-parse', 'HEAD'], prepared.dir)).toBe(mainBefore);

    const runId = h.engine.start({ ...prepared.input, yes: true });
    // The owner's decision is durable: in the run folder and in the journal.
    const yaml = readFileSync(path.join(h.store.runDir(runId), RECOMMENDATION_FILE), 'utf8');
    expect(yaml).toContain('tool_slug: "order-export"');
    expect(yaml).toContain('decided_at: "2026-05-01T12:00:00.000Z"');
    expect(h.engine.entries(runId).find((e) => e.type === 'stack.approved')).toMatchObject({
      stack: 'backshack-tool',
      decision: { fit: { toolSlug: 'order-export' } },
    });

    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    // The plan moved the worktree's own branch forward; no other branch was left in backshack-dev.
    expect(await out(['rev-parse', '--abbrev-ref', 'HEAD'], prepared.dir)).toBe(prepared.branch);
    expect(await out(['branch', '--list', 'incubator/enhance-*'], devRepo)).toBe('');
    expect(prompts.some((p) => p.includes(CONTRACT.trim()))).toBe(true);
    // The guides and tickets the plan names are in the worktree for the agent and the verify, hidden from git.
    const tickets = path.join(prepared.dir, '.incubator', 'tickets');
    expect(existsSync(path.join(prepared.dir, '.incubator', '.gitignore'))).toBe(true);
    expect(existsSync(tickets) && readdirSync(tickets).some((f) => f.endsWith('.json'))).toBe(true);
    expect(await out(['status', '--porcelain'], prepared.dir)).not.toContain('.incubator');

    // The plan sends the agent to the new tool's own package, not to files of the repository the request's words matched.
    const clone = path.join(h.store.runDir(runId), 'workspace', 'repo');
    const planned = readdirSync(path.join(clone, 'docs', 'plans'))
      .map((f) => readFileSync(path.join(clone, 'docs', 'plans', f), 'utf8'))
      .join('\n');
    for (const target of backshackTargets('order-export')) expect(planned).toContain(target);
    expect(planned).not.toContain('index.js');

    h.engine.submitCommit(runId, { action: 'commit' });
    const done = await h.engine.resume(runId, new DefaultsPrompter());
    expect(done.state).toBe('DONE');
    expect(h.engine.entries(runId).findLast((e) => e.type === 'run.done')).toMatchObject({
      committedLocally: true,
    });
    // Committed on the branch, never pushed, no pull request, no Incubator guides in the repository.
    expect(await out(['status', '--porcelain'], prepared.dir)).toBe('');
    // The executor plan, tickets and lanes stay in the run folder: the branch holds only the tool's commit.
    expect(await out(['rev-list', '--count', `${mainBefore}..HEAD`], prepared.dir)).toBe('1');
    const committed = await out(['diff', '--name-only', mainBefore, 'HEAD'], prepared.dir);
    expect(committed).not.toMatch(/^(docs\/plans\/|\.incubator\/)/m);
    expect(prompts.some((p) => p.includes('# Plan '))).toBe(true);
    // The agent is held to a token cap that stops it mid-run, and what it processed is recorded for tracking.
    expect(h.engine.entries(runId).find((e) => e.type === 'handoff.launch')).toMatchObject({
      ceilings: { tokens: BACKSHACK_TOKEN_CEILING },
    });
    expect(h.engine.entries(runId).find((e) => e.type === 'handoff.result')).toMatchObject({
      tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
    });
    expect(await h.github.getBranchSha(ref, prepared.branch)).toBeNull();
    expect(h.github.repos.get(`${ref.owner}/${ref.name}`)!.prs).toEqual([]);
    expect(existsSync(path.join(prepared.dir, 'WHAT-NOW.md'))).toBe(false);
    // The owner's report matches ADR-030: no push or pull request from the Incubator.
    const guide = (await h.engine.finishDetail(runId))?.whatNow;
    expect(guide?.title).toBe('What now: order-export');
    expect(guide?.next.join(' ')).not.toContain('Push the branch from the Incubator');
  });

  it('parks when the agent changed nothing instead of ending the run done, and the owner can leave it', async () => {
    vi.stubEnv('FAKE_AGENT_MODE', 'idle');
    const { h } = await backshackHarness();
    const prepared = await h.engine.backshackPrepare({
      narrative: REQUEST,
      fit: { toolName: 'Order Export' },
      rationale: ['A staged AI workflow for paying members.'],
      surface: 'test',
    });
    const runId = h.engine.start({ ...prepared.input, yes: true });
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    h.engine.submitCommit(runId, { action: 'leave' });
    expect((await h.engine.resume(runId, new DefaultsPrompter())).state).toBe('DONE');
  });

  it('proposes the contract’s group-guard lint as a check the owner can approve', async () => {
    const { h } = await backshackHarness();
    const prepared = await h.engine.backshackPrepare({
      narrative: REQUEST,
      fit: { toolName: 'Order Export' },
      surface: 'test',
    });
    const runId = h.engine.start({ ...prepared.input, yes: true });
    await h.engine.advance(runId, new DefaultsPrompter());
    const lint =
      'php wp-content/plugins/backshack-datalake/bin/lint-group-guard.php --enforce --tool=order-export';
    const proposed = h.engine.proposedChecks(runId).map((c) => c.command);
    expect(proposed[0]).toBe(lint);
    expect(validateChecks(proposed)).toEqual([]);
  });

  it('parks with a clear error when the contract is missing, and never creates a worktree without it', async () => {
    const { h, generator } = await backshackHarness({ contract: null });
    await expect(
      h.engine.backshackPrepare({
        narrative: REQUEST,
        fit: { toolName: 'Order Export' },
        surface: 'test',
      }),
    ).rejects.toMatchObject({ reason: 'backshack_contract_missing' });
    expect(existsSync(path.join(h.home, 'worktrees', 'backshack-order-export'))).toBe(false);

    // A contract that goes missing after the run started parks it before anything is planned.
    writeFileSync(path.join(generator, 'docs', 'BACKSHACK_CONTRACT.md'), CONTRACT);
    const prepared = await h.engine.backshackPrepare({
      narrative: REQUEST,
      fit: { toolName: 'Order Export' },
      surface: 'test',
    });
    rmSync(path.join(generator, 'docs', 'BACKSHACK_CONTRACT.md'));
    const runId = h.engine.start({ ...prepared.input, yes: true });
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ reason: 'backshack_contract_missing' });
    expect(s.parked?.message).toMatch(/Backshack Build Contract is missing/);
    expect(h.engine.backshackProbe()).toMatchObject({ ok: false });
  });

  it('refuses a backshack-tool run outside its worktree, or one that would publish', async () => {
    const { h } = await backshackHarness();
    const prepared = await h.engine.backshackPrepare({
      narrative: REQUEST,
      fit: { toolName: 'Order Export' },
      surface: 'test',
    });
    expect(() => h.engine.start({ ...prepared.input, dir: os.tmpdir() })).toThrow(/must work in/);
    expect(() => h.engine.start({ ...prepared.input, noPublish: false })).toThrow(/committed only/);
    await expect(
      h.engine.backshackPrepare({
        narrative: REQUEST,
        fit: { toolName: 'Order Export' },
        surface: 'test',
      }),
    ).rejects.toMatchObject({ code: 'worktree_exists' });
  });
});

describe('a node-web run (ADR-030)', () => {
  it('never carries the Backshack contract in its coding prompt, even when Backshack is configured', async () => {
    const prompts: string[] = [];
    const h = fakePublishEngine({
      handoff: { exec: recordingExec(prompts), probe: () => Promise.resolve(agentCaps) },
      config: () => ({ backshack: { devRepo: os.tmpdir(), generatorRepo: generatorRepo() } }),
    });
    const draft = JSON.parse(
      readFileSync(path.join(combos, 'node-web.in-repo.docker-host.json'), 'utf8'),
    ) as Record<string, unknown>;
    const project = { ...(draft['project'] as object), owner: { type: 'user', login: 'octo' } };
    const spec: IncubatorSpec = completeSpec({ ...draft, project }).spec;
    const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'new solution ')), 'web app');
    const runId = h.engine.startFromSpec(spec, { kind: 'new', surface: 'test', dir });
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) {
      expect(p).not.toContain('Backshack Build Contract');
      expect(p).not.toContain(CONTRACT.trim());
    }
  });
});
