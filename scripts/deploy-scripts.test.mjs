// Unit tests for the deploy, release and scaffold scripts: the repository's own copies and the
// pack-only scripts (staged into a throwaway tree that mirrors a generated repository's layout).
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { missingSettings, PLACEHOLDER } from './deploy/preflight.mjs';
import { smoke } from './deploy/smoke.mjs';
import { latestPromote } from './deploy/verify-promote-target.mjs';
import { gaps, plan, readLog, validateTasks } from './run-deploy-tasks.mjs';
import { fill, placeholders, planFeature, scenarioStubs } from './scaffold.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const packs = path.join(here, '../packages/templates/packs');

function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'deploy-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    writeFileSync(
      path.join(root, rel),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }
  return root;
}

/** Copies a pack script next to the guard toolkit it imports and loads it. */
async function packScript(packRel, dest) {
  const root = mkdtempSync(path.join(tmpdir(), 'pack-script-'));
  cpSync(path.join(here, 'guard/lib'), path.join(root, 'scripts/guard/lib'), { recursive: true });
  mkdirSync(path.dirname(path.join(root, dest)), { recursive: true });
  cpSync(path.join(packs, packRel), path.join(root, dest));
  return import(pathToFileURL(path.join(root, dest)).href);
}

const task = (over = {}) => ({
  name: 'migrate-db',
  env: ['staging', 'prod'],
  idempotent: true,
  runOnce: false,
  timeout: 60,
  command: ['node', 'x.mjs'],
  ...over,
});

describe('run-deploy-tasks', () => {
  it('validates the task file', () => {
    expect(validateTasks({ tasks: [task()] })).toEqual([]);
    expect(validateTasks({})).toEqual(['.deploy-tasks.json needs a "tasks" array']);
    const errors = validateTasks({
      tasks: [
        task({ name: 'Bad Name', env: ['dev'], runOnce: 'no', timeout: 0, command: 'rm -rf' }),
        task({ name: 'Bad Name' }),
      ],
    });
    expect(errors.join('\n')).toMatch(
      /kebab-case[\s\S]*env must[\s\S]*runOnce must[\s\S]*timeout[\s\S]*argv array[\s\S]*duplicate name/,
    );
  });

  it('plans runOnce, per-sha and idempotent tasks and reports staging/prod gaps', () => {
    const log = [
      { name: 'seed', env: 'staging', sha: 'aaaaaaa1', status: 'ok' },
      { name: 'migrate-db', env: 'staging', sha: 'bbbbbbb2', status: 'ok' },
      { name: 'migrate-db', env: 'prod', sha: 'aaaaaaa1', status: 'ok' },
      { name: 'migrate-db', env: 'staging', sha: 'ccccccc3', status: 'failed' },
    ];
    const tasks = [
      task({ name: 'seed', env: ['staging'], runOnce: true }),
      task(),
      task({ name: 'prod-only', env: ['prod'], idempotent: false }),
    ];
    expect(plan(tasks, log, 'staging', 'bbbbbbb2').map((p) => [p.task.name, p.action])).toEqual([
      ['seed', 'skip'],
      ['migrate-db', 'skip'],
    ]);
    expect(plan(tasks, log, 'prod', 'bbbbbbb2').map((p) => [p.task.name, p.action, p.why])).toEqual(
      [
        ['migrate-db', 'run', 'idempotent'],
        ['prod-only', 'run', 'first run for this sha'],
      ],
    );
    expect(gaps(log)).toEqual(['migrate-db@bbbbbbb2', 'seed@aaaaaaa1']);
    const dir = tree({ 'log.jsonl': `${JSON.stringify(log[0])}\n\n${JSON.stringify(log[1])}\n` });
    expect(readLog(path.join(dir, 'log.jsonl'))).toHaveLength(2);
    expect(readLog(path.join(dir, 'missing.jsonl'))).toEqual([]);
  });
});

describe('deploy helpers', () => {
  it('preflight names unset and placeholder settings', () => {
    expect(missingSettings(['A', 'B', 'C'], { A: 'x', B: PLACEHOLDER })).toEqual(['B', 'C']);
  });

  it('smoke retries until healthy, and gives up with the last error', async () => {
    const seen = [];
    const responses = [new Error('refused'), { status: 503 }, { status: 200 }];
    const fetchImpl = (url) => {
      seen.push(String(url));
      const r = responses.shift();
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    };
    const sleep = () => Promise.resolve();
    expect(
      await smoke('https://staging.example', {
        attempts: 5,
        fetchImpl,
        sleep,
        path: '/?rest_route=/x/v1/health',
      }),
    ).toEqual({ ok: true, attempts: 3 });
    expect(seen[0]).toBe('https://staging.example/?rest_route=/x/v1/health');
    const down = await smoke('https://x.example', {
      attempts: 2,
      fetchImpl: () => Promise.resolve({ status: 500 }),
      sleep,
    });
    expect(down).toEqual({ ok: false, attempts: 2, last: 'HTTP 500' });
  });

  it('finds the latest promote merge', () => {
    const log = [
      'a1\x1ffix: thing\x1e',
      'b2\x1fpromote: staging to production\n\nPromote-Run: 42\x1e',
      'c3\x1fPromote-Run: 41\x1e',
    ].join('\n');
    expect(latestPromote(log)).toBe('b2');
    expect(latestPromote('a1\x1fno trailer\x1e')).toBeNull();
  });
});

describe('scaffold', () => {
  const repo = () =>
    tree({
      'config/features.json': { features: [{ id: 'health', summary: 'Health' }] },
      'config/scaffold.json': {
        feature: {
          files: [{ template: 't/feature.tmpl', dest: 'src/features/{{FEATURE_ID}}.ts' }],
          markers: [
            {
              file: 'src/index.ts',
              region: 'exports',
              text: "export { {{FEATURE_CAMEL}} } from './features/{{FEATURE_ID}}.js';",
            },
          ],
        },
      },
      't/feature.tmpl': '// {{FEATURE_SUMMARY}} {{FEATURE_PASCAL}} {{FEATURE_SNAKE}} {{UNKNOWN}}\n',
      'src/index.ts': '// <scaffold:exports>\n// </scaffold:exports>\n',
      '.incubator/tracker.json': { type: 'local' },
    });

  it('derives placeholders and fills templates', () => {
    expect(placeholders('reorder-alerts', ' Alert\nwhen low ', 'enhancement/new')).toMatchObject({
      FEATURE_PASCAL: 'ReorderAlerts',
      FEATURE_CAMEL: 'reorderAlerts',
      FEATURE_SNAKE: 'reorder_alerts',
      FEATURE_SUMMARY: 'Alert when low',
    });
    expect(fill('{{A}} {{B}}', { A: '1' })).toBe('1 {{B}}');
    expect(scenarioStubs('x').map((s) => [s.id, s.tags[0], s.status])).toEqual([
      ['happy-path', 'happy', 'todo'],
      ['validation-missing-input', 'validation', 'todo'],
      ['validation-bad-input', 'validation', 'todo'],
      ['fault-dependency-down', 'fault', 'todo'],
    ]);
  });

  it('plans every change for a new feature without touching the disk', () => {
    const root = repo();
    const { errors, changes } = planFeature(root, {
      id: 'reorder-alerts',
      summary: 'Alert when low',
      lane: 'enhancement/new',
    });
    expect(errors).toEqual([]);
    expect(changes.map((c) => `${c.kind} ${c.path}`)).toEqual([
      'create src/features/reorder-alerts.ts',
      'create tests/scenarios/reorder-alerts/happy-path.json',
      'create tests/scenarios/reorder-alerts/validation-missing-input.json',
      'create tests/scenarios/reorder-alerts/validation-bad-input.json',
      'create tests/scenarios/reorder-alerts/fault-dependency-down.json',
      'patch src/index.ts',
      'patch config/features.json',
      'create .incubator/tickets/F-reorder-alerts.json',
    ]);
    expect(changes[0].content).toBe('// Alert when low ReorderAlerts reorder_alerts {{UNKNOWN}}\n');
    expect(changes[5].content).toContain(
      "// @reorder-alerts\nexport { reorderAlerts } from './features/reorder-alerts.js';",
    );
    expect(existsSync(path.join(root, 'src/features/reorder-alerts.ts'))).toBe(false);
  });

  it('refuses bad ids, missing summaries and duplicates', () => {
    const root = repo();
    expect(planFeature(root, { id: 'Bad_Id', summary: '', lane: 'x' }).errors).toEqual([
      'feature id "Bad_Id" must be kebab-case',
      '--summary is required',
    ]);
    expect(planFeature(root, { id: 'health', summary: 'x', lane: 'x' }).errors).toContain(
      'feature "health" already exists',
    );
  });
});

describe('pack scripts', () => {
  it('vps-release keeps timestamped releases, swaps current atomically and rolls back', async () => {
    if (process.platform === 'win32') return; // runs on the Linux self-hosted runner only
    const m = await packScript(
      'deploy/vps-tailscale/files/scripts/deploy/vps-release.mjs',
      'scripts/deploy/vps-release.mjs',
    );
    expect(m.releaseName(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)), 'abcdef0123')).toBe(
      '20260102030405-abcdef0',
    );
    const root = mkdtempSync(path.join(tmpdir(), 'vps-'));
    const from = tree({ 'app.txt': 'v' });
    const names = [];
    for (let i = 0; i < 7; i++)
      names.push(
        m.release(root, `${i}`.repeat(7), from, 5, new Date(Date.UTC(2026, 0, 1, 0, 0, i))),
      );
    expect(m.listReleases(root)).toEqual(names.slice(2));
    expect(readlinkSync(path.join(root, 'current'))).toBe(path.join('releases', names[6]));
    expect(m.rollback(root)).toBe(names[5]);
    expect(readFileSync(path.join(root, 'current/app.txt'), 'utf8')).toBe('v');
  });

  it('docker-remote validates every remote argument and builds ssh/compose argv without a shell', async () => {
    const m = await packScript(
      'deploy/docker-host/files/scripts/deploy/docker-remote.mjs',
      'scripts/deploy/docker-remote.mjs',
    );
    const env = {
      DEPLOY_SSH_TARGET: 'deploy@host.example',
      DEPLOY_DIR: 'srv/app/',
      COMPOSE_PROJECT: 'app-staging',
      SSH_KEY_FILE: 'k',
      SSH_KNOWN_HOSTS_FILE: 'kh',
    };
    const s = m.settings(env);
    expect(s.dir).toBe('srv/app');
    expect(() => m.settings({})).toThrow('missing environment');
    expect(() => m.settings({ ...env, DEPLOY_DIR: 'x; rm -rf y' })).toThrow(
      'unsafe remote argument',
    );
    for (const bad of ['a b', '$(id)', '`id`', 'a;b', 'a|b', 'a&b', "a'b", 'a\nb'])
      expect(() => m.safeArg(bad)).toThrow();
    expect(m.sshArgs(s, ['mkdir', '-p', 'srv/app'])).toEqual([
      '-i',
      'k',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'UserKnownHostsFile=kh',
      '-o',
      'BatchMode=yes',
      '-p',
      '22',
      'deploy@host.example',
      '--',
      'mkdir',
      '-p',
      'srv/app',
    ]);
    expect(m.scpArgs(s, 'deploy/compose.host.yaml', 'srv/app/compose.yaml').slice(-2)).toEqual([
      'deploy/compose.host.yaml',
      'deploy@host.example:srv/app/compose.yaml',
    ]);
    expect(m.composeArgv(s, 'ghcr.io/o/app@sha256:ab', ['pull'])).toEqual([
      'env',
      'IMAGE_REF=ghcr.io/o/app@sha256:ab',
      'docker',
      'compose',
      '--project-directory',
      'srv/app',
      '-f',
      'srv/app/compose.yaml',
      '-p',
      'app-staging',
      'pull',
    ]);
  });

  it('docker-remote deploys the digest, records it and rolls back to the previous good image', async () => {
    const m = await packScript(
      'deploy/docker-host/files/scripts/deploy/docker-remote.mjs',
      'scripts/deploy/docker-remote.mjs',
    );
    const s = m.settings({
      DEPLOY_SSH_TARGET: 'd@h',
      DEPLOY_DIR: 'app',
      COMPOSE_PROJECT: 'p',
      SSH_KEY_FILE: 'k',
      SSH_KNOWN_HOSTS_FILE: 'kh',
    });
    let releases = '';
    const calls = [];
    const exec = (cmd, args, opts = {}) => {
      const remote = args.slice(args.indexOf('--') + 1);
      calls.push(cmd === 'scp' ? 'scp' : remote.join(' '));
      if (remote[0] === 'tee') releases += opts.input;
      if (remote[0] === 'cat') return Promise.resolve({ code: 0, stdout: releases, stderr: '' });
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };
    const remote = m.createRemote(s, { exec, whichImpl: (n) => [n, []] });
    await remote.deploy('r/app@sha256:1', 'a1', 'c.yaml', new Date(0));
    await remote.deploy('r/app@sha256:2', 'b2', 'c.yaml', new Date(0));
    expect(calls.slice(0, 5)).toEqual([
      'mkdir -p app',
      'scp',
      'env IMAGE_REF=r/app@sha256:1 docker compose --project-directory app -f app/compose.yaml -p p pull',
      'env IMAGE_REF=r/app@sha256:1 docker compose --project-directory app -f app/compose.yaml -p p up -d --wait',
      'tee -a app/releases.log',
    ]);
    expect(await remote.rollback(new Date(0))).toMatchObject({
      sha: 'a1',
      image: 'r/app@sha256:1',
    });
    expect(m.parseReleases(releases).at(-1)).toMatchObject({
      image: 'r/app@sha256:1',
      rollbackOf: 'r/app@sha256:2',
    });
    await expect(remote.rollback()).rejects.toThrow('no earlier release');
    await expect(remote.deploy('bad image', 'x')).rejects.toThrow('unsafe remote argument');
    const failing = m.createRemote(s, {
      exec: () => Promise.resolve({ code: 1, stdout: '', stderr: 'denied' }),
      whichImpl: (n) => [n, []],
    });
    await expect(failing.deploy('r/app@sha256:1', 'a1')).rejects.toThrow(
      'mkdir failed (exit 1): denied',
    );
  });

  it('docker-remote picks the previous release that was never rolled back', async () => {
    const m = await packScript(
      'deploy/docker-host/files/scripts/deploy/docker-remote.mjs',
      'scripts/deploy/docker-remote.mjs',
    );
    const r = (image, rollbackOf) => ({ sha: image, image, ...(rollbackOf ? { rollbackOf } : {}) });
    expect(m.previousRelease([])).toBeNull();
    expect(m.previousRelease([r('a')])).toBeNull();
    expect(m.previousRelease([r('a'), r('b'), r('c')]).image).toBe('b');
    expect(m.previousRelease([r('a'), r('b'), r('c'), r('b', 'c')]).image).toBe('a');
  });

  it('package release helpers check bins, checksums, tags and already-published versions', async () => {
    const smokeMod = await packScript(
      'deploy/package-release/files/scripts/release/package-smoke.mjs',
      'scripts/release/package-smoke.mjs',
    );
    expect(smokeMod.binEntries({ name: '@o/tool', bin: 'dist/bin.js' })).toEqual({
      tool: 'dist/bin.js',
    });
    expect(smokeMod.binEntries({ name: 'tool', bin: { a: 'x.js' } })).toEqual({ a: 'x.js' });
    expect(smokeMod.binEntries({ name: 'lib' })).toEqual({});
    const dir = tree({ 'pkg-1.0.0.tgz': 'bytes' });
    expect(smokeMod.sha256sums([path.join(dir, 'pkg-1.0.0.tgz')])).toBe(
      '277089d91c0bdf4f2e6862ba7e4a07605119431f5d13f726dd352b06f1b206a9  pkg-1.0.0.tgz\n',
    );
    const gate = await packScript(
      'deploy/package-release/files/scripts/release/version-gate.mjs',
      'scripts/release/version-gate.mjs',
    );
    expect(gate.checkTag('1.2.3', 'v1.2.3')).toEqual([]);
    expect(gate.checkTag('1.2.3', undefined)).toEqual([]);
    expect(gate.checkTag('1.2.3', 'v1.2.4')).toEqual([
      'tag v1.2.4 does not match package.json version 1.2.3',
    ]);
    expect(gate.publishedFinding('p', '1.0.0', { code: 0, stdout: '1.0.0\n', stderr: '' })).toEqual(
      ['p@1.0.0 is already published; bump the version'],
    );
    expect(
      gate.publishedFinding('p', '1.0.0', { code: 1, stdout: '', stderr: 'npm error code E404' }),
    ).toEqual([]);
    expect(() =>
      gate.publishedFinding('p', '1.0.0', { code: 1, stdout: '', stderr: 'ETIMEDOUT' }),
    ).toThrow('npm view failed');
  });
});
