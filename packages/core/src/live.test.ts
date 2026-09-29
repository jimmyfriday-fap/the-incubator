import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Logger, MemorySink } from '@incubator/runtime';
import { loadConfig } from './config.js';
import { createLiveEngine } from './live.js';

describe('live wiring', () => {
  it('builds the engine on a home directory without touching the network', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'live-home-'));
    writeFileSync(path.join(home, 'config.json'), JSON.stringify({ discovery: { timeoutMs: 5 } }));
    const live = createLiveEngine({ log: new Logger([new MemorySink()]), home, env: {} });
    expect(live.home).toBe(home);
    expect(live.config).toEqual({ discovery: { timeoutMs: 5 } });
    expect(live.store.list()).toEqual([]);
    const runId = live.engine.start({ kind: 'new', narrative: 'x', surface: 'test' });
    expect(live.engine.state(runId).state).toBe('INTAKE');
  });

  it('reads config.json and refuses malformed files', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    expect(loadConfig(home)).toEqual({});
    writeFileSync(path.join(home, 'config.json'), '[1]');
    expect(() => loadConfig(home)).toThrow(/invalid .*config\.json: not an object/);
    writeFileSync(path.join(home, 'config.json'), '{');
    expect(() => loadConfig(home)).toThrow(/invalid/);
  });
});
