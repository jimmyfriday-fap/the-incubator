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

describe('incubator scaffold', () => {
  const combo = (name: string) =>
    path.resolve(import.meta.dirname, `../../../packages/templates/fixtures/combos/${name}.json`);
  const lib = combo('node-lib.in-repo.package-release');

  it('--validate-only renders in memory and reports the packs', async () => {
    const t = io();
    expect(await main(['scaffold', lib, '--validate-only'], t.io)).toBe(0);
    expect(t.err.join('')).toMatch(
      /spec is valid; \d+ files would be rendered \(base@1\.0\.0, stack\/node-lib@1\.0\.0/,
    );
  });

  it('--dry-run lists files with hashes and writes nothing', async () => {
    const t = io();
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'scaffold-')), 'app');
    expect(await main(['scaffold', lib, '--dry-run', '--out', out], t.io)).toBe(0);
    expect(t.out.join('')).toMatch(/^[0-9a-f]{12} {2}0644 {2}base\s+\.claude\/settings\.json$/m);
    expect(() => readFileSync(path.join(out, 'package.json'))).toThrow();
  });

  it('writes the tree with pinned pack versions and refuses a non-empty target', async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'scaffold-')), 'app');
    const t = io();
    expect(await main(['scaffold', lib, '--out', out], t.io)).toBe(0);
    const spec = JSON.parse(readFileSync(path.join(out, 'incubator.json'), 'utf8')) as {
      templates: { packs: { id: string }[] };
    };
    expect(spec.templates.packs.map((p) => p.id)).toEqual([
      'base',
      'stack/node-lib',
      'deploy/package-release',
      'test-home/in-repo',
    ]);
    const again = io();
    expect(await main(['scaffold', lib, '--out', out], again.io)).toBe(2);
    expect(again.err.join('')).toContain('is not empty');
    const lock = readFileSync(path.join(out, '.incubator/lock.json'), 'utf8');
    expect(
      await main(['scaffold', path.join(out, 'incubator.json'), '--out', out, '--force'], io().io),
    ).toBe(0);
    // Re-rendering from the generated incubator.json reproduces the tree byte for byte.
    expect(readFileSync(path.join(out, '.incubator/lock.json'), 'utf8')).toBe(lock);
  });

  it('writes the paired tests repository next to the app', async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'scaffold-')), 'shipnote');
    const t = io();
    expect(
      await main(['scaffold', combo('node-lib.paired-repo.package-release'), '--out', out], t.io),
    ).toBe(0);
    expect(
      readFileSync(path.join(out, '..', 'shipnote-tests', 'tests', 'scenarios.test.ts'), 'utf8'),
    ).toContain('scenario');
  });

  it('rejects invalid specs and bad usage with exit 2', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'scaffold-'));
    const bad = path.join(dir, 'bad.json');
    writeFileSync(
      bad,
      JSON.stringify({
        project: { name: 'Xy', slug: 'xy', description: 'x' },
        platform: 'library',
        stack: { pack: 'node-lib' },
        deploy: { target: 'vps-tailscale' },
      }),
    );
    const t = io();
    expect(await main(['scaffold', bad, '--validate-only'], t.io)).toBe(2);
    expect(t.err.join('')).toContain('libraries and CLIs deploy as package-release');
    writeFileSync(path.join(dir, 'broken.json'), '{ nope');
    expect(
      await main(['scaffold', path.join(dir, 'broken.json'), '--validate-only'], io().io),
    ).toBe(2);
    expect(await main(['scaffold', lib], io().io)).toBe(2);
    writeFileSync(path.join(dir, 'array.json'), '[]');
    expect(await main(['scaffold', path.join(dir, 'array.json'), '--validate-only'], io().io)).toBe(
      2,
    );
  });
});
