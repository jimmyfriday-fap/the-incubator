import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Engine, RunStore } from '@incubator/core';
import { completeSpec } from '@incubator/spec';
import { FAKE_GITHUB_TOKEN, discoveryFixtureDir, fakePublishEngine } from '@incubator/core/testing';
import { FakeLlmAdapter, createLlmRegistry } from '@incubator/llm';
import { FakeGitHub } from '@incubator/git';
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
      github: () => new FakeGitHub(nodeExec, { login: 'octo' }),
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

describe('publish, handoff, auth, gc', () => {
  const fakeAgent = path.resolve(
    import.meta.dirname,
    '../../../packages/core/fixtures/handoff/fake-agent.mjs',
  );
  function publishDeps() {
    const agentCaps = {
      installed: true,
      path: process.execPath,
      version: '1',
      flags: { printMode: [fakeAgent, '-p'], streamJson: ['--output-format', 'stream-json'] },
      stdinPrompt: true,
      eligible: { discovery: false, analysis: false, handoff: true },
      reasons: [],
    };
    const h = fakePublishEngine({
      handoff: { exec: nodeExec, probe: () => Promise.resolve(agentCaps) },
    });
    const keychain = new MemoryKeychain();
    const deps: CliDeps = {
      home: h.home,
      clock: h.clock,
      exec: nodeExec,
      keychain,
      log: new Logger([new MemorySink()], {}, undefined, h.clock),
      config: {},
      llm: createLlmRegistry({ exec: nodeExec, keychain, env: { INCUBATOR_HOME: h.home } }),
      store: h.store,
      engine: h.engine,
      github: () => h.github,
    };
    return { h, deps, factory: (() => deps) as DepsFactory };
  }
  const specFile = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'publish-spec-'));
    const draft = JSON.parse(
      readFileSync(
        path.resolve(
          import.meta.dirname,
          '../../../packages/templates/fixtures/combos/node-lib.in-repo.package-release.json',
        ),
        'utf8',
      ),
    ) as { project: Record<string, unknown> };
    draft.project['owner'] = { type: 'user', login: 'octo' };
    writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(draft));
    return path.join(dir, 'spec.json');
  };

  it('publishes a spec and prints the summary; handoff prints then launches', async () => {
    const { h, factory } = publishDeps();
    const t = io();
    expect(await main(['publish', specFile()], t.io, factory)).toBe(0);
    const err = t.err.join('');
    expect(err).toContain('✔ published https://github.com/octo/tallyho');
    expect(err).toContain('NPM_TOKEN');
    expect(t.out.join('') + err).not.toContain(FAKE_GITHUB_TOKEN);
    const runId = /incubator handoff (\S+) --launch/.exec(err)![1]!;
    const printed = io();
    expect(await main(['handoff', runId], printed.io, factory)).toBe(0);
    // The printed command double-quotes any path with a space, so the closing quote is optional.
    expect(printed.out.join('')).toMatch(/fake-agent\.mjs"? -p --output-format stream-json/);
    expect(printed.err.join('')).toContain('ticket      F-counter');
    process.env['FAKE_AGENT_MODE'] = 'complete';
    const launched = io();
    expect(await main(['handoff', runId, '--launch'], launched.io, factory)).toBe(0);
    expect(launched.err.join('')).toContain(
      'F-counter is READY_FOR_TEST (2 turns, 1 tool calls, $0.42)',
    );
    process.env['FAKE_AGENT_MODE'] = 'spend';
    expect(await main(['handoff', runId, '--launch', '--agent', 'nope'], io().io, factory)).toBe(2);
    expect(h.github.repos.has('octo/tallyho')).toBe(true);
  });

  it('parks a publish on a taken name and resumes it by run id', async () => {
    const { h, factory } = publishDeps();
    await h.github.createRepo({
      owner: 'octo',
      name: 'tallyho',
      ownerType: 'user',
      visibility: 'private',
      description: 'theirs',
    });
    const t = io();
    expect(await main(['publish', specFile()], t.io, factory)).toBe(2);
    const runId = /resume with: incubator resume (\S+)/.exec(t.err.join(''))![1]!;
    h.github.repos.delete('octo/tallyho');
    const again = io();
    expect(await main(['publish', runId], again.io, factory)).toBe(0);
    expect(again.err.join('')).toContain('✔ published');
    expect(await main(['publish', 'no-such-file.json'], io().io, factory)).toBe(2);
  });

  it('adopts a repository through a pull request, or reports it compliant', async () => {
    const { h, factory } = publishDeps();
    const ref = { owner: 'octo', name: 'order-desk' };
    await h.github.createRepo({
      ...ref,
      ownerType: 'user',
      visibility: 'private',
      description: 'x',
    });
    const src = path.join(mkdtempSync(path.join(tmpdir(), 'adopt-cli-')), 'order-desk');
    cpSync(
      path.resolve(import.meta.dirname, '../../../packages/analyzer/fixtures/bare-node'),
      src,
      {
        recursive: true,
        filter: (f) => !f.endsWith('expected-gap-report.json'),
      },
    );
    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['add', '-A'],
      ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'x'],
      ['push', '-q', h.github.remoteUrl(ref), 'HEAD:refs/heads/main'],
    ])
      await nodeExec.run('git', args, { cwd: src, timeoutMs: 30_000 });
    const t = io();
    expect(
      await main(
        ['adopt', h.github.remoteUrl(ref), '--repo', 'octo/order-desk', '--yes'],
        t.io,
        factory,
      ),
    ).toBe(0);
    expect(t.err.join('')).toContain(
      '✔ opened https://github.com/octo/order-desk/pull/1 (1 present, 0 partial, 36 missing)',
    );
    const local = io();
    expect(
      await main(
        ['adopt', src, '--repo', 'octo/order-desk', '--no-publish', '--yes'],
        local.io,
        factory,
      ),
    ).toBe(0);
    expect(local.err.join('')).toContain('adopt branch written locally');
    expect(await main(['adopt', src, '--repo', 'not a repo'], io().io, factory)).toBe(2);
  });

  it('stores credentials in the keychain only and reports their sources', async () => {
    const { deps, factory } = publishDeps();
    const t = { ...io(), secret: 'test-secret-github-token' };
    const withSecret = { ...t.io, readSecret: () => Promise.resolve(`${t.secret}\n`) };
    expect(await main(['auth', 'set', 'github'], withSecret, factory)).toBe(0);
    expect(await deps.keychain.get('incubator', 'github')).toBe('test-secret-github-token');
    expect(t.err.join('') + t.out.join('')).not.toContain('test-secret-github-token');
    const st = io();
    expect(await main(['auth', 'status'], st.io, factory)).toBe(0);
    expect(st.out.join('')).toContain('github     from keychain');
    expect(await main(['auth', 'set', 'nope'], withSecret, factory)).toBe(2);
    expect(await main(['auth', 'delete', 'github'], io().io, factory)).toBe(0);
    expect(await deps.keychain.get('incubator', 'github')).toBeNull();
  });

  it('ui serves the localhost UI until stopped, printing the single-use link with --no-open', async () => {
    const { deps } = publishDeps();
    let stop!: () => void;
    const stopped = new Promise<void>((r) => (stop = r));
    const t = io();
    const running = main(['ui', '--no-open'], t.io, () => ({ ...deps, stop: stopped }));
    let url = '';
    for (let i = 0; i < 200 && !url; i++) {
      url = t.out.join('').trim();
      if (!url) await new Promise((r) => setTimeout(r, 10));
    }
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?t=[\w-]{43}$/);
    const boot = await fetch(url, { redirect: 'manual' });
    expect(boot.status).toBe(302);
    const cookie = boot.headers.get('set-cookie')!.split(';')[0]!;
    const origin = new URL(url).origin;
    expect((await fetch(`${origin}/api/runs`, { headers: { cookie } })).status).toBe(200);
    stop();
    expect(await running).toBe(0);
    await expect(fetch(`${origin}/api/runs`)).rejects.toThrow();
    expect(t.err.join('')).toContain(`serving ${origin}`);
  });

  it('opens the browser with the platform opener and no shell', async () => {
    const { openBrowser } = await import('./commands/ui.js');
    const calls: string[][] = [];
    const exec = {
      which: () => Promise.resolve(null),
      run: (b: string, a: readonly string[]) => {
        calls.push([b, ...a]);
        return Promise.resolve({
          code: b === 'xdg-open' ? 3 : 0,
          signal: null,
          stdout: '',
          stderr: '',
          timedOut: false,
        });
      },
    };
    expect(await openBrowser(exec, 'http://127.0.0.1:1/?t=x', 'darwin')).toBe(true);
    expect(await openBrowser(exec, 'http://127.0.0.1:1/?t=x', 'win32')).toBe(true);
    expect(await openBrowser(exec, 'http://127.0.0.1:1/?t=x', 'linux')).toBe(false);
    expect(calls).toEqual([
      ['open', 'http://127.0.0.1:1/?t=x'],
      ['rundll32', 'url.dll,FileProtocolHandler', 'http://127.0.0.1:1/?t=x'],
      ['xdg-open', 'http://127.0.0.1:1/?t=x'],
    ]);
    const failing = { which: exec.which, run: () => Promise.reject(new Error('ENOENT')) };
    expect(await openBrowser(failing, 'u', 'linux')).toBe(false);
  });

  it('gc removes old finished runs and leftover workspaces, keeping parked runs', async () => {
    const { h, factory } = publishDeps();
    const done = h.engine.startFromSpec(
      h.engine.approvedSpec(
        h.engine.startFromSpec(completeSpecFrom(specFile()), { kind: 'scaffold', surface: 'test' }),
      ),
      { kind: 'scaffold', surface: 'test', keep: true },
    );
    await h.engine.advance(done, undefined as never);
    const dry = io();
    expect(await main(['gc', '--days', '30', '--dry-run'], dry.io, factory)).toBe(0);
    expect(dry.out.join('')).toContain(`would remove workspace of ${done}`);
    expect(await main(['gc', '--days', '0'], io().io, factory)).toBe(0);
    expect(() => h.engine.state(done)).toThrow();
  });
});

function completeSpecFrom(file: string) {
  return completeSpec(JSON.parse(readFileSync(file, 'utf8')) as never).spec;
}
