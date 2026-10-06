import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixtures } from '@incubator/llm';
import { Logger } from '@incubator/runtime';
import { Engine } from './engine.js';
import {
  MARKER_PATH,
  Portfolio,
  markerText,
  normalizeRemote,
  readMarker,
  type PortfolioProject,
} from './portfolio.js';
import { DefaultsPrompter } from './prompter.js';
import { enhanceFixtureDir, fakePublishEngine, seedExistingRepo } from './testing.js';

const analyzerFixtures = path.resolve(import.meta.dirname, '../../analyzer/fixtures');
const REQUEST = 'Kitchen staff need to export the orders list as a CSV file.';
const home = () => mkdtempSync(path.join(tmpdir(), 'portfolio home '));
const input = (over: Partial<PortfolioProject> = {}) => ({
  name: 'Club Events',
  summary: 'Sign-ups for the club',
  origin: 'existing' as const,
  repo: { dir: null, remote: null, ref: null, url: null },
  stack: null,
  ...over,
});

describe('the portfolio store (ADR-028)', () => {
  it('keeps projects in one JSON file, most recently touched first, runs newest first', () => {
    let n = 0;
    const pf = new Portfolio(home(), () => `2026-10-0${++n}T00:00:00.000Z`);
    expect(pf.exists()).toBe(false);
    expect(pf.list()).toEqual([]);
    const a = pf.create(input({ name: 'A' }));
    const b = pf.create(input({ name: 'B' }));
    expect(pf.exists()).toBe(true);
    expect(pf.list().map((p) => p.name)).toEqual(['B', 'A']);
    const run = (runId: string, startedAt: string) => ({
      runId,
      kind: 'enhance',
      request: 'r',
      startedAt,
      state: 'DONE',
      done: true,
      outcome: null,
    });
    pf.attachRun(a.id, run('r1', '2026-10-01T00:00:00Z'));
    pf.attachRun(a.id, run('r2', '2026-10-02T00:00:00Z'));
    expect(pf.get(a.id)!.runs.map((r) => r.runId)).toEqual(['r2', 'r1']);
    expect(pf.list().map((p) => p.name)).toEqual(['A', 'B']);
    expect(pf.forRun('r1')?.id).toBe(a.id);
    expect(pf.forRun('nope')).toBeUndefined();
    // Attaching the same run again refreshes it rather than listing it twice.
    pf.attachRun(a.id, { ...run('r1', '2026-10-01T00:00:00Z'), state: 'FAILED', done: false });
    expect(pf.get(a.id)!.runs.filter((r) => r.runId === 'r1')).toHaveLength(1);
    expect(pf.get(a.id)!.runs.find((r) => r.runId === 'r1')!.state).toBe('FAILED');
    expect(pf.get(b.id)!.runs).toEqual([]);
    expect(pf.update('missing', () => undefined)).toBeUndefined();
  });

  it('recognises a project by its marker, then its remote, then its folder, and never by name', () => {
    const pf = new Portfolio(home());
    const dir = path.join(tmpdir(), 'somewhere', 'club');
    const a = pf.create(
      input({
        name: 'Club',
        repo: { dir, remote: 'git@github.com:Octo/club.git', ref: null, url: null },
      }),
    );
    const other = pf.create(input({ name: 'Other' }));
    expect(pf.match({ markerId: other.id, remote: 'https://github.com/octo/club', dir })?.id).toBe(
      other.id,
    );
    expect(pf.match({ remote: 'https://github.com/octo/club.git/' })?.id).toBe(a.id);
    expect(pf.match({ remote: 'ssh://git@github.com/OCTO/club' })?.id).toBe(a.id);
    expect(pf.match({ dir: path.join(dir, '..', 'club') })?.id).toBe(a.id);
    expect(pf.match({ markerId: 'not-a-known-id' })).toBeUndefined();
    expect(pf.match({ dir: path.join(tmpdir(), 'club') })).toBeUndefined(); // same name, other place
    expect(pf.match({})).toBeUndefined();
  });

  it('writes the file atomically and survives a damaged one', () => {
    const h = home();
    const pf = new Portfolio(h);
    pf.create(input());
    expect(readdirSync(h).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    writeFileSync(pf.file, '{ not json');
    expect(pf.list()).toEqual([]);
    expect(readdirSync(h).some((f) => f.startsWith('portfolio.json.damaged-'))).toBe(true);
    expect(pf.create(input()).id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('remote spellings', () => {
  it('compares equal however the remote is written', () => {
    const a = normalizeRemote('git@github.com:octo/club.git');
    for (const u of [
      'https://github.com/octo/club',
      'https://github.com/octo/club.git',
      'HTTPS://GitHub.com/Octo/Club/',
      'ssh://git@github.com/octo/club.git',
      'https://token@github.com/octo/club.git',
    ])
      expect(normalizeRemote(u), u).toBe(a);
    expect(normalizeRemote('https://github.com/octo/other')).not.toBe(a);
    expect(normalizeRemote(null)).toBeNull();
    expect(normalizeRemote('  ')).toBeNull();
  });
});

describe('the repository marker', () => {
  it('names the project, and only a well-formed marker counts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'marker '));
    expect(readMarker(dir)).toBeNull();
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    mkdirSync(path.join(dir, '.incubator'), { recursive: true });
    writeFileSync(path.join(dir, MARKER_PATH), markerText({ id, name: 'Club' }));
    expect(readMarker(dir)).toBe(id);
    expect(markerText({ id, name: 'Club' })).toBe(
      `{\n  "incubatorProject": "${id}",\n  "name": "Club"\n}\n`,
    );
    for (const bad of [
      '{ nope',
      '{"incubatorProject": 5}',
      '{"incubatorProject": "../../x"}',
      '[]',
    ]) {
      writeFileSync(path.join(dir, MARKER_PATH), bad);
      expect(readMarker(dir), bad).toBeNull();
    }
  });
});

describe('the portfolio in a run', () => {
  async function seeded(h: ReturnType<typeof fakePublishEngine>, name = 'bare-node') {
    return seedExistingRepo(h.github, name, path.join(analyzerFixtures, name));
  }
  const start = (
    h: ReturnType<typeof fakePublishEngine>,
    repo: string,
    ref: { owner: string; name: string },
  ) =>
    h.engine.start({
      kind: 'enhance',
      repo,
      repoRef: ref,
      request: REQUEST,
      noPublish: true,
      yes: true,
      surface: 'test',
    });
  // why: fixture turns are consumed once, so a test that runs the request twice replays them twice.
  // The review summary is written only when a screen asks for it, so a run never uses that turn.
  const engine = (runs = 1) =>
    fakePublishEngine({
      portfolio: true,
      llm: Array.from({ length: runs }, () =>
        loadFixtures(enhanceFixtureDir('export-orders')).filter(
          (t) => t.schemaName !== 'ReviewSummary',
        ),
      ).flat(),
    });

  it('files a run under a new project, follows it to the end, and delivers the marker', async () => {
    const h = engine();
    const { ref, dir } = await seeded(h);
    const runId = start(h, dir, ref);
    await h.engine.advance(runId, new DefaultsPrompter());
    const projects = h.engine.portfolioList();
    expect(projects).toHaveLength(1);
    const p = projects[0]!;
    expect(p).toMatchObject({
      name: path.basename(dir),
      origin: 'existing',
      repo: { dir, ref, url: `https://github.com/${ref.owner}/${ref.name}` },
    });
    // The model's own summary of what the repository is becomes the project's summary.
    expect(p.summary).toContain('order-desk is a small Express service');
    expect(p.runs).toHaveLength(1);
    expect(p.runs[0]).toMatchObject({
      runId,
      kind: 'enhance',
      state: 'DONE',
      done: true,
      request: REQUEST,
    });
    expect(h.engine.portfolioForRun(runId)?.id).toBe(p.id);
    // The marker rides with the delivery, and names this project.
    const ws = path.join(h.store.runDir(runId), 'workspace', 'repo');
    expect(readMarker(ws)).toBe(p.id);
    expect(JSON.parse(readFileSync(path.join(ws, MARKER_PATH), 'utf8'))).toEqual({
      incubatorProject: p.id,
      name: p.name,
    });
  });

  it('puts a second run on the same folder under the same project, and a marker finds it elsewhere', async () => {
    const h = engine(2);
    const { ref, dir } = await seeded(h);
    const first = start(h, dir, ref);
    const second = start(h, dir, ref);
    await h.engine.advance(first, new DefaultsPrompter());
    await h.engine.advance(second, new DefaultsPrompter());
    const [p] = h.engine.portfolioList();
    expect(h.engine.portfolioList()).toHaveLength(1);
    expect(p!.runs.map((r) => r.runId).sort()).toEqual([first, second].sort());
    // A copy of the repository in another folder, marker included, is the same project.
    const ws = path.join(h.store.runDir(first), 'workspace', 'repo');
    const copy = path.join(mkdtempSync(path.join(tmpdir(), 'copy ')), 'renamed');
    cpSync(ws, copy, { recursive: true });
    rmSync(path.join(copy, '.git'), { recursive: true, force: true });
    expect((await h.engine.portfolioFor(copy))?.id).toBe(p!.id);
    // A folder that was never part of it is not.
    expect(await h.engine.portfolioFor(mkdtempSync(path.join(tmpdir(), 'other ')))).toBeUndefined();
  });

  it('makes a project of its own for a repository it has not met', async () => {
    const h = engine(2);
    const a = await seeded(h, 'bare-node');
    const b = await seeded(h, 'flutter-app');
    await h.engine.advance(start(h, a.dir, a.ref), new DefaultsPrompter());
    await h.engine.advance(start(h, b.dir, b.ref), new DefaultsPrompter());
    expect(
      h.engine
        .portfolioList()
        .map((p) => p.repo.ref?.name)
        .sort(),
    ).toEqual([a.ref.name, b.ref.name].sort());
  });

  it('records a stack label and the outcome once there is one', async () => {
    const h = engine();
    const { ref, dir } = await seeded(h, 'flutter-app');
    const runId = start(h, dir, ref);
    await h.engine.advance(runId, new DefaultsPrompter());
    const p = h.engine.portfolioForRun(runId)!;
    expect(p.stack).toBe('Dart/Flutter');
    expect(p.runs[0]!.state).toBe('DONE');
  });

  it('leaves a run and its folder alone when the portfolio is off: no marker, no project', async () => {
    const h = fakePublishEngine({
      llm: { dir: enhanceFixtureDir('export-orders') },
    });
    const { ref, dir } = await seeded(h);
    const runId = start(h, dir, ref);
    await h.engine.advance(runId, new DefaultsPrompter());
    expect(h.engine.portfolioList()).toEqual([]);
    expect(existsSync(path.join(h.store.runDir(runId), 'workspace', 'repo', MARKER_PATH))).toBe(
      false,
    );
  });

  it('fills itself from the runs already on disk the first time', async () => {
    const h = fakePublishEngine({
      llm: { dir: enhanceFixtureDir('export-orders') },
    });
    const { ref, dir } = await seeded(h);
    const runId = start(h, dir, ref);
    await h.engine.advance(runId, new DefaultsPrompter());
    // A later build, with the portfolio on, finds that run and files it.
    const later = new Engine({
      store: h.store,
      clock: h.clock,
      log: new Logger([h.sink], {}, undefined, h.clock),
      llm: { select: () => Promise.reject(new Error('unused')) },
      portfolio: new Portfolio(h.home),
    });
    expect(later.portfolioList()).toEqual([]);
    await later.portfolioBackfill();
    const [p] = later.portfolioList();
    expect(p).toMatchObject({ origin: 'existing' });
    expect(p!.runs[0]).toMatchObject({ runId, state: 'DONE', done: true, request: REQUEST });
    expect(p!.summary).toContain('order-desk');
    // And only once: the file now exists, so a second call changes nothing.
    await later.portfolioBackfill();
    expect(later.portfolioList()).toHaveLength(1);
  });
});
