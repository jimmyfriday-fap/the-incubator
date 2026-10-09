import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigStore, Engine, RunStore } from '@incubator/core';
import { completeSpec } from '@incubator/spec';
import {
  FAKE_GITHUB_TOKEN,
  discoveryFixtureDir,
  enhanceFixtureDir,
  fakePublishEngine,
  fakeSettings,
  seedExistingRepo,
} from '@incubator/core/testing';
import { FakeLlmAdapter, createLlmRegistry } from '@incubator/llm';
import { FakeGitHub } from '@incubator/git';
import { FixedClock, Logger, MemoryKeychain, MemorySink, nodeExec } from '@incubator/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CliDeps, DepsFactory } from './deps.js';
import { main, type InterruptControl } from './main.js';

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

describe('incubator config', () => {
  const withSettings = () => {
    const d = testDeps('ts-library');
    const factory: DepsFactory = (o) => {
      const deps = d.factory(o);
      deps.settings = fakeSettings(d.home, new ConfigStore(d.home));
      return deps;
    };
    return { factory, home: d.home };
  };

  it('shows what the next run uses, then sets, reads and clears a setting', async () => {
    const { factory, home } = withSettings();
    const show = io();
    expect(await main(['config'], show.io, factory)).toBe(0);
    expect(show.out.join('')).toMatch(/planning\s+claude-cli · the tool’s default model/);
    expect(show.out.join('')).toContain('incubator config set');

    const set = io();
    expect(
      await main(['config', 'set', 'coding.model', 'claude-sonnet-5-5'], set.io, factory),
    ).toBe(0);
    expect(set.err.join('')).toContain('coding.model = claude-sonnet-5-5');
    expect(JSON.parse(readFileSync(path.join(home, 'config.json'), 'utf8'))).toEqual({
      agents: { model: 'claude-sonnet-5-5' },
    });
    const got = io();
    expect(await main(['config', 'get', 'coding.model'], got.io, factory)).toBe(0);
    expect(got.out.join('').trim()).toBe('claude-sonnet-5-5');

    expect(await main(['config', 'set', 'limits.gcDays', '14'], io().io, factory)).toBe(0);
    const where = path.resolve('flutter');
    expect(await main(['config', 'set', 'toolPath.flutter', where], io().io, factory)).toBe(0);
    const again = io();
    await main(['config'], again.io, factory);
    expect(again.out.join('')).toContain('removed after 14 days');
    expect(again.out.join('')).toContain(`flutter = ${where}`);

    // "default" and "auto" go back to automatic, and the empty sections disappear.
    expect(await main(['config', 'set', 'coding.model', 'default'], io().io, factory)).toBe(0);
    expect(await main(['config', 'set', 'limits.gcDays', 'default'], io().io, factory)).toBe(0);
    expect(await main(['config', 'set', 'toolPath.flutter', 'default'], io().io, factory)).toBe(0);
    expect(JSON.parse(readFileSync(path.join(home, 'config.json'), 'utf8'))).toEqual({});
  });

  it('refuses a bad value, an unknown setting and a missing argument with exit 2, saving nothing', async () => {
    const { factory, home } = withSettings();
    for (const argv of [
      ['config', 'set', 'coding.model', '--evil'],
      ['config', 'set', 'limits.gcDays', 'abc'],
      ['config', 'set', 'toolPath.flutter', 'relative'],
      ['config', 'set', 'planning.tool', 'gpt'],
      ['config', 'set', 'nonsense', '1'],
      ['config', 'get', 'nonsense'],
      ['config', 'get'],
      ['config', 'set', 'coding.model'],
      ['config', 'dance'],
    ]) {
      const t = io();
      expect(await main(argv, t.io, factory), argv.join(' ')).toBe(2);
      expect(t.err.join(''), argv.join(' ')).not.toBe('');
    }
    expect(() => readFileSync(path.join(home, 'config.json'), 'utf8')).toThrow();
  });

  it('says so when settings are not available, and doctor shows what is in use', async () => {
    const none = io();
    expect(await main(['config'], none.io, testDeps('ts-library').factory)).toBe(2);
    expect(none.err.join('')).toContain('settings are not available');
    const { factory } = withSettings();
    const doc = io();
    await main(['doctor'], doc.io, factory);
    expect(doc.out.join('')).toContain('In use for the next run:');
    expect(doc.out.join('')).toMatch(/coding\s+claude · default model/);
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
  function publishDeps(
    llm?: Parameters<typeof fakePublishEngine>[0] extends infer O
      ? O extends { llm?: infer L }
        ? L
        : never
      : never,
    extra: { portfolio?: boolean } = {},
  ) {
    const agentCaps = {
      installed: true,
      path: process.execPath,
      version: '1',
      flags: {
        printMode: [fakeAgent, '-p'],
        streamJson: ['--output-format', 'stream-json'],
        allowedTools: '--allowedTools',
      },
      stdinPrompt: true,
      eligible: { discovery: false, analysis: false, handoff: true },
      reasons: [],
    };
    const h = fakePublishEngine({
      handoff: { exec: nodeExec, probe: () => Promise.resolve(agentCaps) },
      ...(llm ? { llm } : {}),
      ...(extra.portfolio ? { portfolio: true } : {}),
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

  it('Ctrl+C stops the agent of a handoff and exits 130', async () => {
    const { h, factory } = publishDeps();
    const t = io();
    expect(await main(['publish', specFile()], t.io, factory)).toBe(0);
    const runId = /incubator handoff (\S+) --launch/.exec(t.err.join(''))![1]!;
    process.env['FAKE_AGENT_MODE'] = 'slow';
    const control: InterruptControl = {};
    const launched = io();
    const running = main(['handoff', runId, '--launch'], launched.io, factory, control);
    // Once the agent has started and written something, the launcher's handler stops it, as Ctrl+C does.
    for (let i = 0; i < 400; i++) {
      if (h.engine.entries(runId).some((e) => e.type === 'handoff.launch')) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await new Promise((r) => setTimeout(r, 1500));
    expect(control.stop?.()).toBe(1);
    expect(await running).toBe(130);
    expect(launched.err.join('')).toContain('⏹ stopped');
    process.env['FAKE_AGENT_MODE'] = 'complete';
  });

  it('gives the launcher something to stop for a command that does work, and nothing for ui', async () => {
    const { factory } = publishDeps();
    const control: InterruptControl = {};
    await main(['doctor'], io().io, factory, control);
    expect(control.stop).toBeTypeOf('function');
    expect(control.stop!()).toBe(0); // nothing is running, so the launcher exits at once
    const forUi: InterruptControl = {};
    await main(
      ['ui', '--no-open'],
      io().io,
      (o) => ({ ...factory(o), stop: Promise.resolve('test') }),
      forUi,
    );
    expect(forUi.stop).toBeUndefined();
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

  describe('incubator enhance', () => {
    const bareNode = path.resolve(
      import.meta.dirname,
      '../../../packages/analyzer/fixtures/bare-node',
    );
    const REQUEST = 'Kitchen staff need to export the orders list as a CSV file.';
    const setup = async (fixture = 'export-orders') => {
      const d = publishDeps({ dir: enhanceFixtureDir(fixture) });
      const { ref, dir } = await seedExistingRepo(d.h.github, 'order-desk', bareNode);
      return { ...d, ref, dir };
    };

    it('lists the portfolio, shows one project with its runs, and refuses a name it does not know', async () => {
      const d = publishDeps({ dir: enhanceFixtureDir('export-orders') }, { portfolio: true });
      const { dir } = await seedExistingRepo(d.h.github, 'order-desk', bareNode);
      const empty = io();
      expect(await main(['portfolio'], empty.io, d.factory)).toBe(0);
      expect(empty.out.join('')).toContain('No projects yet');
      const run = ['enhance', dir, '--repo', 'octo/order-desk', '--prompt', REQUEST];
      expect(await main([...run, '--no-publish', '--yes'], io().io, d.factory)).toBe(0);
      const name = path.basename(dir);
      const list = io();
      expect(await main(['portfolio'], list.io, d.factory)).toBe(0);
      expect(list.out.join('')).toContain(name);
      expect(list.out.join('')).toContain('1 runs');
      expect(list.out.join('')).toContain('DONE');
      const json = io();
      expect(await main(['portfolio', '--json'], json.io, d.factory)).toBe(0);
      const projects = JSON.parse(json.out.join('')) as { id: string; runs: unknown[] }[];
      expect(projects).toHaveLength(1);
      expect(projects[0]!.runs).toHaveLength(1);
      // By the start of its id, or its name: the project and the request it was asked.
      for (const ref of [projects[0]!.id.slice(0, 8), name]) {
        const one = io();
        expect(await main(['portfolio', ref], one.io, d.factory)).toBe(0);
        expect(one.out.join('')).toContain(projects[0]!.id);
        expect(one.out.join('')).toContain('Kitchen staff need to export');
      }
      const one = io();
      expect(await main(['portfolio', projects[0]!.id, '--json'], one.io, d.factory)).toBe(0);
      expect(JSON.parse(one.out.join('')) as { id: string }).toMatchObject({ id: projects[0]!.id });
      const missing = io();
      expect(await main(['portfolio', 'nope'], missing.io, d.factory)).toBe(2);
      expect(missing.err.join('')).toContain('no project matches');
    });

    it('writes the enhance branch locally, or opens a pull request with the gaps separate', async () => {
      const { h, factory, dir } = await setup();
      const local = io();
      expect(
        await main(
          [
            'enhance',
            dir,
            '--repo',
            'octo/order-desk',
            '--prompt',
            REQUEST,
            '--no-publish',
            '--yes',
          ],
          local.io,
          factory,
        ),
      ).toBe(0);
      const err = local.err.join('');
      expect(err).toContain('✔ enhance branch written locally');
      expect(err).toContain('docs/plans/001-enhance-20260501.md (1 request(s);');
      expect(err).toMatch(/incubator handoff \S+ --launch/);
      expect(h.github.calls.some((c) => c.method === 'openPr')).toBe(false);

      const { h: h2, factory: factory2, ref: ref2 } = await setup();
      const pr = io();
      expect(
        await main(
          [
            'enhance',
            h2.github.remoteUrl(ref2),
            '--repo',
            'octo/order-desk',
            '--prompt',
            REQUEST,
            '--with-gaps',
            '--yes',
          ],
          pr.io,
          factory2,
        ),
      ).toBe(0);
      expect(pr.err.join('')).toContain('✔ opened https://github.com/octo/order-desk/pull/1');
      expect(pr.err.join('')).toContain('canonical pattern gaps in a separate commit');
    });

    it('parks for the request off a terminal, and resume --prompt answers it', async () => {
      const { factory, dir } = await setup();
      const parked = io();
      expect(
        await main(
          ['enhance', dir, '--repo', 'octo/order-desk', '--no-publish', '--yes'],
          parked.io,
          factory,
        ),
      ).toBe(2);
      const hint = /incubator resume (\S+) --prompt/.exec(parked.err.join(''));
      expect(hint).not.toBeNull();
      const done = io();
      expect(
        await main(['resume', hint![1]!, '--prompt', REQUEST, '--yes'], done.io, factory),
      ).toBe(0);
      expect(done.err.join('')).toContain('✔ enhance branch written locally');
    });

    it('resume --refresh reads a repository that moved on again and shows what was asked, to confirm (plan 027)', async () => {
      const { factory, dir } = await setup('refresh');
      const first = io();
      expect(
        await main(
          ['enhance', dir, '--repo', 'octo/order-desk', '--prompt', REQUEST, '--no-publish'],
          first.io,
          factory,
        ),
      ).toBe(2);
      const runId = /incubator resume (\S+)/.exec(first.err.join(''))![1]!;
      const git = (args: string[]) => nodeExec.run('git', args, { cwd: dir, timeoutMs: 30_000 });
      writeFileSync(path.join(dir, 'later.txt'), 'later\n');
      await git(['add', '-A']);
      await git([
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.invalid',
        'commit',
        '-q',
        '-m',
        'later',
      ]);
      // Approving stops at the move, and the hint names the refresh.
      const approve = io();
      expect(await main(['resume', runId, '--yes'], approve.io, factory)).toBe(2);
      expect(approve.err.join('')).toContain(`refresh with: incubator resume ${runId} --refresh`);
      // --refresh goes on its own, and is refused before the run is touched.
      const both = io();
      expect(
        await main(['resume', runId, '--refresh', '--prompt', REQUEST], both.io, factory),
      ).toBe(2);
      expect(both.err.join('')).toContain('use --refresh on its own');
      const refreshed = io();
      expect(await main(['resume', runId, '--refresh'], refreshed.io, factory)).toBe(2);
      expect(refreshed.err.join('')).toContain('what you asked before (confirm it or edit it):');
      expect(refreshed.err.join('')).toContain(`    ${REQUEST}`);
      expect(refreshed.err.join('')).toContain('(or --prompt-file <file> for a longer text)');
      const done = io();
      expect(await main(['resume', runId, '--prompt', REQUEST, '--yes'], done.io, factory)).toBe(0);
      expect(done.err.join('')).toContain('✔ enhance branch written locally');
    });

    it('resume --change corrects the plan at review in words, and the plan is drafted again (plan 032)', async () => {
      const { factory, dir, h } = await setup('review-changes');
      const first = io();
      expect(
        await main(
          ['enhance', dir, '--repo', 'octo/order-desk', '--prompt', REQUEST, '--no-publish'],
          first.io,
          factory,
        ),
      ).toBe(2);
      const runId = /incubator resume (\S+)/.exec(first.err.join(''))![1]!;
      expect(first.err.join('')).toContain(
        `change the plan with: incubator resume ${runId} --change "what to change"`,
      );
      // --change goes on its own, and is refused before the run is touched.
      const both = io();
      expect(await main(['resume', runId, '--change', 'x', '--refresh'], both.io, factory)).toBe(2);
      expect(both.err.join('')).toContain('use --change on its own');
      expect(h.engine.entries(runId).some((e) => e.type === 'repo.refresh')).toBe(false);
      // --yes would approve the redrafted plan unseen; --commit has nothing to answer at review.
      for (const extra of [['--yes'], ['--commit']])
        expect(await main(['resume', runId, '--change', 'x', ...extra], io().io, factory)).toBe(2);
      const changed = io();
      expect(
        await main(
          ['resume', runId, '--change', 'Also let kitchen staff filter the export by date.'],
          changed.io,
          factory,
        ),
      ).toBe(2);
      expect(changed.err.join('')).toContain('parked at REVIEW');
      expect(h.engine.entries(runId).filter((e) => e.type === 'review.feedback')).toHaveLength(1);
      expect(h.engine.finalSpec(runId)!.intent.coreFeatures.map((f) => f.id)).toEqual([
        'export-orders',
        'export-filter',
      ]);
      // The revised plan is shown on the command line (plan 034).
      expect(changed.err.join('')).toContain('  the plan:\n');
      for (const f of h.engine.finalSpec(runId)!.intent.coreFeatures)
        expect(changed.err.join('')).toContain(`    - ${f.id}: ${f.summary}\n`);
      // Adopt runs have no plan to revise: their review park does not offer --change.
      const adopt = io();
      expect(
        await main(['adopt', dir, '--repo', 'octo/order-desk', '--no-publish'], adopt.io, factory),
      ).toBe(2);
      expect(adopt.err.join('')).toContain('parked at REVIEW');
      expect(adopt.err.join('')).not.toContain('change the plan with');
    });

    it('asks for the request on a terminal', async () => {
      const { factory, dir } = await setup();
      const asked: string[] = [];
      const t = io(true);
      const withLine = {
        ...t.io,
        readLine: (m: string) => {
          asked.push(m);
          return Promise.resolve(REQUEST);
        },
      };
      expect(
        await main(
          ['enhance', dir, '--repo', 'octo/order-desk', '--no-publish', '--yes'],
          withLine,
          factory,
        ),
      ).toBe(0);
      expect(asked).toEqual(['What do you want to change?']);
    });

    it('says when there is nothing to change, and rejects bad usage', async () => {
      const { factory, dir } = await setup('no-features');
      const t = io();
      expect(
        await main(
          ['enhance', dir, '--repo', 'octo/order-desk', '--prompt', REQUEST, '--yes'],
          t.io,
          factory,
        ),
      ).toBe(0);
      expect(t.err.join('')).toContain('✔ nothing to change');
      expect(t.err.join('')).toContain('no branch, no pull request');
      for (const extra of [
        ['--prompt-file', 'x.md'],
        ['--adapter', 'nope'],
        ['--repo', 'not a repo'],
      ])
        expect(
          await main(['enhance', dir, '--prompt', REQUEST, ...extra], io().io, factory),
          extra.join(' '),
        ).toBe(2);
    });
  });

  describe('folder runs: the commit and push requests', () => {
    const bareNode = path.resolve(
      import.meta.dirname,
      '../../../packages/analyzer/fixtures/bare-node',
    );
    const REQUEST = 'Kitchen staff need to export the orders list as a CSV file.';
    const saved: Record<string, string | undefined> = {};
    beforeAll(() => {
      // The commit is made as the owner; the machine's own git configuration is not consulted.
      const cfg = path.join(mkdtempSync(path.join(tmpdir(), 'cli gitcfg ')), 'gitconfig');
      writeFileSync(cfg, '[user]\n\tname = Owner Person\n\temail = owner@example.invalid\n');
      for (const k of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'FAKE_AGENT_MODE'])
        saved[k] = process.env[k];
      process.env['GIT_CONFIG_GLOBAL'] = cfg;
      process.env['GIT_CONFIG_NOSYSTEM'] = '1';
      process.env['FAKE_AGENT_MODE'] = 'edit';
    });
    afterAll(() => {
      for (const [k, v] of Object.entries(saved))
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    });
    const setup = async () => {
      const d = publishDeps({ dir: enhanceFixtureDir('export-orders') });
      const { dir } = await seedExistingRepo(d.h.github, 'order-desk', bareNode);
      return { ...d, dir };
    };
    const start = ['--in-place', '--repo', 'octo/order-desk', '--prompt', REQUEST, '--yes'];

    it('parks at the commit request, which --yes does not answer, then commits and pushes on request', async () => {
      const { h, dir, factory } = await setup();
      const a = io();
      expect(await main(['enhance', dir, ...start], a.io, factory)).toBe(2);
      const runId = /run (\S+): the agent has stopped/.exec(a.err.join(''))![1]!;
      expect(a.err.join('')).toContain('src/agent-work.txt');
      expect(a.err.join('')).toContain(`incubator resume ${runId} --commit`);
      // --yes accepts defaults; it is not consent to commit.
      expect(await main(['resume', runId, '--yes'], io().io, factory)).toBe(2);
      expect(await main(['resume', runId, '--push'], io().io, factory)).toBe(2);
      expect(await main(['resume', runId, '-m', 'x'], io().io, factory)).toBe(2);
      const b = io();
      expect(
        await main(['resume', runId, '--commit', '-m', 'feat: export orders'], b.io, factory),
      ).toBe(2);
      expect(b.err.join('')).toContain(`incubator resume ${runId} --push`);
      const log = await nodeExec.run('git', ['log', '-1', '--format=%s|%an'], {
        cwd: dir,
        timeoutMs: 30_000,
      });
      expect(log.stdout.trim()).toBe('feat: export orders|Owner Person');
      expect(h.github.repos.get('octo/order-desk')!.prs).toEqual([]);
      const c = io();
      expect(await main(['resume', runId, '--push'], c.io, factory)).toBe(0);
      expect(c.err.join('')).toContain('✔ opened https://github.com/octo/order-desk/pull/1');
    });

    it('keeps the commit local with --skip-push, and the changes uncommitted with --leave', async () => {
      const first = await setup();
      const a = io();
      await main(['enhance', first.dir, ...start], a.io, first.factory);
      const runA = /run (\S+): the agent has stopped/.exec(a.err.join(''))![1]!;
      await main(['resume', runA, '--commit'], io().io, first.factory);
      const done = io();
      expect(await main(['resume', runA, '--skip-push'], done.io, first.factory)).toBe(0);
      expect(done.err.join('')).toMatch(/✔ committed \w+ on incubator\/enhance-20260501/);

      const second = await setup();
      const b = io();
      await main(['enhance', second.dir, ...start], b.io, second.factory);
      const runB = /run (\S+): the agent has stopped/.exec(b.err.join(''))![1]!;
      const left = io();
      expect(await main(['resume', runB, '--leave'], left.io, second.factory)).toBe(0);
      expect(left.err.join('')).toContain('left the changes uncommitted');
    });

    it('asks on a terminal: the owner reviews the changes, commits, and decides on the push', async () => {
      const { h, dir, factory } = await setup();
      const answers = ['y', 'y'];
      const asked: string[] = [];
      const t = io(true);
      const tty = {
        ...t.io,
        readLine: (m: string) => {
          asked.push(m);
          return Promise.resolve(answers.shift() ?? '');
        },
      };
      expect(
        await main(
          // --yes takes the spec defaults; the commit and the push are still asked.
          ['enhance', dir, '--in-place', '--repo', 'octo/order-desk', '--prompt', REQUEST, '--yes'],
          tty,
          factory,
        ),
      ).toBe(0);
      const err = t.err.join('');
      expect(asked).toEqual([expect.stringContaining('Commit?'), expect.stringContaining('Push')]);
      expect(err).toContain('src/agent-work.txt');
      expect(err).toContain('committing as Owner Person');
      expect(err).toContain('✔ opened https://github.com/octo/order-desk/pull/1');
      expect(h.github.repos.get('octo/order-desk')!.prs).toHaveLength(1);
    });

    it('lets the owner approve check commands with --check, refuses unsafe ones, and hints when none were', async () => {
      // Named on the command line: approved, and they reach the agent's allowed-tool list.
      const first = await setup();
      const a = io();
      await main(
        ['enhance', first.dir, ...start, '--check', 'npm run test', '--check', 'npm run lint'],
        a.io,
        first.factory,
      );
      const runA = /run (\S+): the agent has stopped/.exec(a.err.join(''))![1]!;
      const launchA = first.h.engine.entries(runA).findLast((e) => e.type === 'handoff.launch')!;
      expect(launchA['checks']).toEqual({
        mode: 'approved',
        commands: ['npm run test', 'npm run lint'],
      });
      expect((launchA['argv'] as string[]).join(' ')).toContain('Bash(npm run test:*)');
      expect(a.err.join('')).not.toContain('No check commands were approved');

      // --yes approves nothing: the agent only edits, and the owner is told how to approve.
      const second = await setup();
      const b = io();
      await main(['enhance', second.dir, ...start], b.io, second.factory);
      expect(b.err.join('')).toContain('No check commands were approved for this repository');
      expect(b.err.join('')).toContain('--in-place');

      // --no-checks is a decision, so there is no hint.
      const third = await setup();
      const c = io();
      await main(['enhance', third.dir, ...start, '--no-checks'], c.io, third.factory);
      expect(c.err.join('')).not.toContain('No check commands were approved');

      // An unsafe command is refused before anything runs; both flags together are a usage error.
      const fourth = await setup();
      const d = io();
      expect(
        await main(
          ['enhance', fourth.dir, ...start, '--check', 'npm test; rm -rf .'],
          d.io,
          fourth.factory,
        ),
      ).toBe(2);
      expect(d.err.join('')).toContain('check commands refused');
      const e = io();
      expect(
        await main(
          ['enhance', fourth.dir, ...start, '--check', 'npm run test', '--no-checks'],
          e.io,
          fourth.factory,
        ),
      ).toBe(2);
      expect(e.err.join('')).toContain('either --check or --no-checks');
    });

    it('refuses a bad folder, a URL for --in-place, and a --dir with --spec-only', async () => {
      const { dir, factory } = await setup();
      writeFileSync(path.join(dir, 'half-done.txt'), 'wip\n');
      const dirty = io();
      expect(await main(['enhance', dir, ...start], dirty.io, factory)).toBe(2);
      expect(dirty.err.join('')).toContain('uncommitted');
      expect(
        await main(
          ['enhance', 'https://github.com/octo/x', '--in-place', '--prompt', 'x'],
          io().io,
          factory,
        ),
      ).toBe(2);
      const full = mkdtempSync(path.join(tmpdir(), 'cli-full '));
      writeFileSync(path.join(full, 'a.txt'), 'x');
      const notEmpty = io();
      expect(await main(['new', '--prompt', 'x', '--dir', full], notEmpty.io, factory)).toBe(2);
      expect(notEmpty.err.join('')).toContain('not empty');
      expect(
        await main(['new', '--prompt', 'x', '--dir', full, '--spec-only'], io().io, factory),
      ).toBe(2);
    });
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
