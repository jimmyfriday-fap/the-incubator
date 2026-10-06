import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryKeychain, ToolError } from '@incubator/runtime';
import type { Capabilities, LlmRegistry } from '@incubator/llm';
import { ConfigStore, MODEL_ID, loadConfig, type IncubatorConfig } from './config.js';
import { DefaultsPrompter } from './prompter.js';
import { Settings, applySettings } from './settings.js';
import { enhanceFixtureDir, fakePublishEngine, seedExistingRepo } from './testing.js';

const home = () => mkdtempSync(path.join(tmpdir(), 'settings home '));
const analyzerFixtures = path.resolve(import.meta.dirname, '../../analyzer/fixtures');

describe('applySettings', () => {
  it('sets the planning tool and model, the coding agent and model, the limits and the tool locations', () => {
    const c: IncubatorConfig = {};
    const where = path.resolve('flutter', 'bin');
    applySettings(c, {
      planning: { tool: 'claude-cli', model: 'opus' },
      coding: { agent: 'claude', model: 'claude-sonnet-5-5' },
      limits: { timeoutSeconds: 300, gcDays: 14 },
      toolPaths: { flutter: where },
    });
    expect(c).toEqual({
      llm: { preferred: 'claude-cli', cliModel: 'opus' },
      agents: { primary: 'claude', model: 'claude-sonnet-5-5' },
      discovery: { timeoutMs: 300_000 },
      gc: { days: 14 },
      toolPaths: { flutter: where },
    });
  });

  it('goes back to automatic and leaves no empty sections, and keeps what it does not know', () => {
    const c: IncubatorConfig & { custom: number } = {
      custom: 1,
      llm: { preferred: 'claude-cli', cliModel: 'opus', anthropic: { effort: 'high' } },
      agents: { primary: 'claude', model: 'x' },
      discovery: { timeoutMs: 5000 },
      gc: { days: 3 },
      toolPaths: { flutter: path.resolve('f') },
    };
    applySettings(c, {
      planning: { tool: 'auto', model: null },
      coding: { agent: 'auto', model: '' },
      limits: { timeoutSeconds: null, gcDays: null },
      toolPaths: {},
    });
    expect(c).toEqual({ custom: 1, llm: { anthropic: { effort: 'high' } } });
  });

  it('refuses what would reach a command line or the disk wrongly, naming the problem', () => {
    const bad = (patch: Parameters<typeof applySettings>[1]) =>
      expect(() => applySettings({}, patch)).toThrow(
        expect.objectContaining({ code: 'bad_settings' }),
      );
    bad({ planning: { model: 'opus; rm -rf /' } });
    bad({ coding: { model: '--evil' } });
    bad({ coding: { model: 'a b' } });
    bad({ planning: { tool: 'fake' as never } });
    bad({ planning: { tool: 'gpt' as never } });
    bad({ coding: { agent: 'vim' as never } });
    bad({ limits: { timeoutSeconds: 1 } });
    bad({ limits: { timeoutSeconds: 99_999 } });
    bad({ limits: { gcDays: 0 } });
    bad({ limits: { gcDays: 1.5 } });
    bad({ toolPaths: { flutter: 'relative/bin' } });
    bad({ toolPaths: { 'bad name': path.resolve('x') } });
    expect(MODEL_ID.test('claude-opus-5-5')).toBe(true);
    expect(MODEL_ID.test('gpt-5.1:high')).toBe(true);
  });
});

describe('ConfigStore', () => {
  it('saves atomically with mode 0600, keeps unknown keys, and rereads what is on disk', () => {
    const h = home();
    writeFileSync(
      path.join(h, 'config.json'),
      JSON.stringify({ custom: { keep: true }, gc: { days: 9 } }),
    );
    const store = new ConfigStore(h);
    store.update((c) => {
      c.agents = { model: 'opus' };
    });
    expect(JSON.parse(readFileSync(store.file, 'utf8'))).toEqual({
      custom: { keep: true },
      gc: { days: 9 },
      agents: { model: 'opus' },
    });
    expect(readdirSync(h).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    if (process.platform !== 'win32') expect(statSync(store.file).mode & 0o777).toBe(0o600);
    // An edit made by hand is seen by the next read.
    writeFileSync(store.file, JSON.stringify({ gc: { days: 1 } }));
    expect(store.get()).toEqual({ gc: { days: 1 } });
  });

  it('keeps the last good copy when the file is damaged, and saves nothing when a change throws', () => {
    const h = home();
    const store = new ConfigStore(h);
    store.update((c) => {
      c.gc = { days: 5 };
    });
    writeFileSync(store.file, '{ nope');
    expect(store.get()).toEqual({ gc: { days: 5 } });
    expect(() => loadConfig(h)).toThrow(/invalid/);
    writeFileSync(store.file, JSON.stringify({ gc: { days: 7 } }));
    expect(() =>
      store.update((c) => {
        c.gc = { days: 8 };
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(JSON.parse(readFileSync(store.file, 'utf8'))).toEqual({ gc: { days: 7 } });
  });

  it('creates the folder when there is none', () => {
    const h = path.join(home(), 'not', 'yet');
    new ConfigStore(h).update((c) => {
      c.gc = { days: 2 };
    });
    expect(loadConfig(h)).toEqual({ gc: { days: 2 } });
  });
});

describe('Settings', () => {
  const caps = (installed: boolean, handoff: boolean, model?: string): Capabilities => ({
    installed,
    ...(installed ? { version: '2.0.0' } : {}),
    flags: model ? { model } : {},
    stdinPrompt: true,
    eligible: { discovery: installed, analysis: installed, handoff },
    reasons: installed ? [] : ['not installed'],
  });
  const registry = (picked: string | null): LlmRegistry => ({
    adapters: new Map(),
    probeAll: () =>
      Promise.resolve({
        'claude-cli': caps(true, true, '--model'),
        'copilot-cli': caps(false, false),
        'anthropic-api': caps(true, false),
        fake: caps(true, true),
      }),
    select: () =>
      picked
        ? Promise.resolve({ id: picked } as never)
        : Promise.reject(new ToolError('no LLM adapter is available')),
  });
  const make = (picked: string | null = 'claude-cli') => {
    const h = home();
    const config = new ConfigStore(h);
    const settings = new Settings({
      home: h,
      config,
      llm: registry(picked),
      keychain: new MemoryKeychain(),
      credentials: () => Promise.resolve([{ account: 'github', source: 'gh' }]),
    });
    return { settings, config, h };
  };

  it('shows what is chosen, what the next run will use, which tools exist and where accounts come from', async () => {
    const { settings } = make();
    const v = await settings.update({
      planning: { model: 'opus' },
      coding: { agent: 'claude', model: 'claude-sonnet-5-5' },
      limits: { timeoutSeconds: 120 },
    });
    expect(v.chosen).toEqual({
      planning: { tool: 'auto', model: 'opus' },
      coding: { agent: 'claude', model: 'claude-sonnet-5-5' },
      limits: { timeoutSeconds: 120, gcDays: null },
      toolPaths: {},
    });
    expect(v.effective).toEqual({
      planning: { tool: 'claude-cli', model: 'opus' },
      coding: { agent: 'claude', model: 'claude-sonnet-5-5', installed: true },
    });
    // The test adapter is not offered; a tool with no model flag says so.
    expect(v.adapters.map((a) => a.id)).toEqual(['claude-cli', 'copilot-cli', 'anthropic-api']);
    expect(v.adapters[0]).toMatchObject({ canPlan: true, canCode: true, takesModel: true });
    expect(v.adapters[1]).toMatchObject({ installed: false, canPlan: false });
    expect(v.credentials).toEqual([{ account: 'github', source: 'gh' }]);
    expect(typeof v.about.keychain).toBe('boolean');
  });

  it('says why no planning tool can run, and shows the default Anthropic model for the API', async () => {
    const none = await make(null).settings.view();
    expect(none.effective.planning).toMatchObject({
      tool: null,
      problem: 'no LLM adapter is available',
    });
    const api = await make('anthropic-api').settings.view();
    expect(api.effective.planning).toEqual({ tool: 'anthropic-api', model: 'claude-opus-5-5' });
  });

  it('rejects a bad change, saves nothing, and reports the tool paths it has', async () => {
    const { settings, config } = make();
    await expect(settings.update({ coding: { model: '--evil' } })).rejects.toMatchObject({
      code: 'bad_settings',
    });
    expect(config.get()).toEqual({});
    const where = path.resolve('flutter');
    expect((await settings.update({ toolPaths: { flutter: where } })).chosen.toolPaths).toEqual({
      flutter: where,
    });
  });
});

describe('models used by a run', () => {
  it('names the tool and model of the analysis and the questions, from the journal', async () => {
    const h = fakePublishEngine({ llm: { dir: enhanceFixtureDir('export-orders') } });
    const { ref, dir } = await seedExistingRepo(
      h.github,
      'bare-node',
      path.join(analyzerFixtures, 'bare-node'),
    );
    const runId = h.engine.start({
      kind: 'enhance',
      repo: dir,
      repoRef: ref,
      request: 'Kitchen staff need to export the orders list as a CSV file.',
      noPublish: true,
      yes: true,
      surface: 'test',
    });
    await h.engine.advance(runId, new DefaultsPrompter());
    const used = h.engine.models(runId);
    expect(used.map((m) => m.job).sort()).toEqual(['analysis', 'planning']);
    expect(used.every((m) => m.tool === 'fake' && m.calls === 1)).toBe(true);
  });
});
