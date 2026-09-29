import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Engine, RunStore } from '@incubator/core';
import { discoveryFixtureDir } from '@incubator/core/testing';
import { FakeLlmAdapter, createLlmRegistry } from '@incubator/llm';
import { FixedClock, Logger, MemoryKeychain, MemorySink, nodeExec } from '@incubator/runtime';
import { describe, expect, it } from 'vitest';
import type { CliDeps, DepsFactory } from './deps.js';
import { main } from './main.js';

function io(isTTY = false) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t), isTTY },
  };
}

function testDeps(fixture: string): { factory: DepsFactory; deps: () => CliDeps; home: string } {
  const home = mkdtempSync(path.join(tmpdir(), 'cli-home-'));
  let deps: CliDeps | undefined;
  const factory: DepsFactory = () => {
    const clock = new FixedClock('2026-05-01T12:00:00Z');
    const log = new Logger([new MemorySink()], {}, undefined, clock);
    const keychain = new MemoryKeychain();
    const llm = createLlmRegistry({
      exec: { which: () => Promise.resolve(null), run: (b, a, o) => nodeExec.run(b, a, o) },
      keychain,
      env: { INCUBATOR_HOME: home },
      extra: [new FakeLlmAdapter({ dir: discoveryFixtureDir(fixture) })],
      config: { preferred: 'fake' },
    });
    const store = new RunStore(clock, home);
    deps = {
      home,
      clock,
      exec: nodeExec,
      keychain,
      log,
      config: {},
      llm,
      store,
      engine: new Engine({ store, clock, log, llm }),
    };
    return deps;
  };
  return { factory, deps: () => deps!, home };
}

describe('cli main', () => {
  it('prints the version and exits 0', async () => {
    const t = io();
    expect(await main(['--version'], t.io)).toBe(0);
    expect(t.out.join('')).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
  it('exits 2 on usage errors and shows help', async () => {
    const t = io();
    expect(await main([], t.io)).toBe(2);
    expect(t.err.join('')).toContain('Usage: incubator');
    const u = io();
    expect(await main(['bogus'], u.io)).toBe(2);
    expect(await main(['--help'], io().io)).toBe(0);
  });
});

describe('incubator new --spec-only', () => {
  it('--yes finishes without prompting (no TTY) and writes the spec', async () => {
    const t = io(false);
    const d = testDeps('saas-web');
    const out = path.join(d.home, 'incubator.json');
    const code = await main(
      ['new', '--prompt', 'Stockroom: café stock tracking', '--spec-only', '--yes', '--out', out],
      t.io,
      d.factory,
    );
    expect(code).toBe(0);
    const spec = JSON.parse(readFileSync(out, 'utf8')) as {
      project: { slug: string };
      decisions: { source: string }[];
    };
    expect(spec.project.slug).toBe('stockroom');
    expect(t.err.join('')).toMatch(/spec approved[\s\S]*decisions/);
  });

  it('prints the spec to stdout when no --out is given', async () => {
    const t = io(false);
    const d = testDeps('ts-library');
    const file = path.join(d.home, 'narrative.md');
    writeFileSync(file, 'semver-lite: a tiny TypeScript library');
    expect(
      await main(
        ['new', '--prompt-file', file, '--spec-only', '--yes', '--adapter', 'fake'],
        t.io,
        d.factory,
      ),
    ).toBe(0);
    expect(JSON.parse(t.out.join(''))).toMatchObject({ platform: 'library' });
  });

  it('parks without a TTY and without --yes (exit 2), then resumes with --yes', async () => {
    const t = io(false);
    const d = testDeps('wp-plugin');
    expect(
      await main(['new', '--prompt', 'EventRSVP plugin', '--spec-only'], t.io, d.factory),
    ).toBe(2);
    const text = t.err.join('');
    expect(text).toMatch(/parked at CLARIFY/);
    const runId = /incubator resume (\S+)/.exec(text)?.[1];
    expect(runId).toBeDefined();
    const r = io(false);
    expect(await main(['resume', runId!, '--yes'], r.io, d.factory)).toBe(0);
    expect(r.err.join('')).toMatch(/resuming run .* \(PARKED: needs_input\)/);
    expect(
      readFileSync(path.join(d.home, 'runs', runId!, 'logs', 'incubator.log'), 'utf8'),
    ).toContain('parked');
  });

  it('rejects bad usage with exit 2', async () => {
    const d = testDeps('ts-library');
    expect(await main(['new', '--spec-only'], io().io, d.factory)).toBe(2);
    expect(
      await main(['new', '--prompt', 'x', '--prompt-file', 'y', '--spec-only'], io().io, d.factory),
    ).toBe(2);
    expect(
      await main(['new', '--prompt', 'x', '--spec-only', '--adapter', 'gpt'], io().io, d.factory),
    ).toBe(2);
    expect(await main(['new', '--prompt', 'x'], io().io, d.factory)).toBe(2);
    expect(await main(['resume', 'not-a-run-id'], io().io, d.factory)).toBe(1);
  });
});

describe('incubator doctor', () => {
  it('reports adapters and exits 0 when discovery is possible', async () => {
    const t = io();
    const d = testDeps('ts-library');
    const code = await main(['doctor'], t.io, d.factory);
    const text = t.out.join('');
    expect(text).toMatch(/node\s+v22/);
    expect(text).toMatch(/fake\s+✔/);
    expect(text).toMatch(/claude-cli\s+✖/);
    expect(code).toBe(0);
  });
});
