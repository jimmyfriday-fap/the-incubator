import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FixedClock, Logger, MemorySink } from '@incubator/runtime';
import { FakeLlmAdapter, type FixtureTurn, type LlmAdapter } from '@incubator/llm';
import { Engine } from './engine.js';
import { RunStore } from './store.js';

/** Test harness: an engine on a temp INCUBATOR_HOME with a fake LLM. */
export function fakeEngine(llm: LlmAdapter | FixtureTurn[] | { dir: string }) {
  const home = mkdtempSync(path.join(tmpdir(), 'incubator-home-'));
  const clock = new FixedClock('2026-05-01T12:00:00Z');
  const sink = new MemorySink();
  const log = new Logger([sink], {}, undefined, clock);
  let adapter = 'invoke' in llm ? llm : new FakeLlmAdapter(llm);
  const store = new RunStore(clock, home);
  const engine = new Engine({ store, clock, log, llm: { select: () => Promise.resolve(adapter) } });
  return {
    engine,
    store,
    home,
    clock,
    sink,
    get adapter() {
      return adapter;
    },
    setAdapter(a: LlmAdapter) {
      adapter = a;
    },
  };
}

export function discoveryFixtureDir(name: string): string {
  return path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    '..',
    'fixtures',
    'discovery',
    name,
  );
}
