#!/usr/bin/env node
// Docker-host deploys over SSH without a remote shell: every remote argument is checked against a
// conservative character set, so nothing a workflow passes can be read as shell syntax on the host.
//   docker-remote.mjs deploy --image <registry/name@sha256:…> --sha <git sha>
//   docker-remote.mjs rollback
//   docker-remote.mjs exec -- <argv…>            (runs inside the app container)
//   docker-remote.mjs fetch-log <file> | push-log <file>   (deploy-task log kept on the host)
// Target and credentials come from the environment: DEPLOY_SSH_TARGET (user@host), DEPLOY_DIR,
// COMPOSE_PROJECT, SSH_KEY_FILE, SSH_KNOWN_HOSTS_FILE, optional SSH_PORT. Host keys are pinned
// (StrictHostKeyChecking=yes against the known_hosts file); the host never gets a key it did not have.
import { readFileSync, writeFileSync } from 'node:fs';
import { EXIT, isMain, parseArgs } from '../guard/lib/common.mjs';
import { run, which } from '../guard/lib/proc.mjs';

const SAFE = /^[A-Za-z0-9@%+=:,./_-]+$/;

export function safeArg(arg) {
  if (typeof arg !== 'string' || !SAFE.test(arg)) throw new Error(`unsafe remote argument: ${JSON.stringify(arg)}`);
  return arg;
}

export function settings(env = process.env) {
  const need = ['DEPLOY_SSH_TARGET', 'DEPLOY_DIR', 'COMPOSE_PROJECT', 'SSH_KEY_FILE', 'SSH_KNOWN_HOSTS_FILE'];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new Error(`missing environment: ${missing.join(', ')}`);
  return {
    target: safeArg(env.DEPLOY_SSH_TARGET),
    dir: safeArg(env.DEPLOY_DIR.replace(/\/+$/, '')),
    project: safeArg(env.COMPOSE_PROJECT),
    key: env.SSH_KEY_FILE,
    knownHosts: env.SSH_KNOWN_HOSTS_FILE,
    port: safeArg(env.SSH_PORT ?? '22'),
  };
}

const sshOptions = (s) => ['-i', s.key, '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${s.knownHosts}`, '-o', 'BatchMode=yes'];

export function sshArgs(s, remote) {
  return [...sshOptions(s), '-p', s.port, s.target, '--', ...remote.map(safeArg)];
}

export function scpArgs(s, local, remotePath) {
  return [...sshOptions(s), '-P', s.port, local, `${s.target}:${safeArg(remotePath)}`];
}

export function composeArgv(s, image, sub) {
  const base = ['docker', 'compose', '--project-directory', s.dir, '-f', `${s.dir}/compose.yaml`, '-p', s.project];
  return image ? ['env', `IMAGE_REF=${image}`, ...base, ...sub] : [...base, ...sub];
}

/** releases.log holds one JSON line per deploy: {sha, image, at, rollbackOf?}. */
export function parseReleases(text) {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/** The image to return to: the latest earlier release that differs from the current one and was never rolled back. */
export function previousRelease(releases) {
  const current = releases.at(-1);
  if (!current) return null;
  const rolledBack = new Set(releases.filter((r) => r.rollbackOf).map((r) => r.rollbackOf));
  rolledBack.add(current.image);
  for (let i = releases.length - 2; i >= 0; i--) {
    if (!rolledBack.has(releases[i].image)) return releases[i];
  }
  return null;
}

export function createRemote(s, { exec = run, whichImpl = which } = {}) {
  const tool = (name) => {
    const bin = whichImpl(name);
    if (!bin) throw new Error(`${name} is not on PATH`);
    return bin;
  };
  const ssh = async (remote, opts = {}) => {
    const bin = tool('ssh');
    const r = await exec(bin[0], [...bin[1], ...sshArgs(s, remote)], { capture: true, ...opts });
    return r;
  };
  const must = async (remote, what, opts) => {
    const r = await ssh(remote, opts);
    if (r.code !== 0) throw Object.assign(new Error(`${what} failed (exit ${r.code}): ${r.stderr.trim()}`), { policy: true });
    return r;
  };
  return {
    ssh,
    async deploy(image, sha, composeFile = 'deploy/compose.host.yaml', now = new Date()) {
      safeArg(image);
      await must(['mkdir', '-p', s.dir], 'mkdir');
      const scp = tool('scp');
      const copied = await exec(scp[0], [...scp[1], ...scpArgs(s, composeFile, `${s.dir}/compose.yaml`)], { capture: true });
      if (copied.code !== 0) throw new Error(`copying the compose file failed: ${copied.stderr.trim()}`);
      await must(composeArgv(s, image, ['pull']), 'compose pull');
      await must(composeArgv(s, image, ['up', '-d', '--wait']), 'compose up');
      await must(['tee', '-a', `${s.dir}/releases.log`], 'recording the release', {
        input: `${JSON.stringify({ sha, image, at: now.toISOString() })}\n`,
      });
    },
    async rollback(now = new Date()) {
      const log = await ssh(['cat', `${s.dir}/releases.log`]);
      const releases = log.code === 0 ? parseReleases(log.stdout) : [];
      const current = releases.at(-1);
      const prev = previousRelease(releases);
      if (!current || !prev) throw Object.assign(new Error('no earlier release to roll back to'), { policy: true });
      await must(composeArgv(s, prev.image, ['pull']), 'compose pull');
      await must(composeArgv(s, prev.image, ['up', '-d', '--wait']), 'compose up');
      await must(['tee', '-a', `${s.dir}/releases.log`], 'recording the rollback', {
        input: `${JSON.stringify({ sha: prev.sha, image: prev.image, at: now.toISOString(), rollbackOf: current.image })}\n`,
      });
      return prev;
    },
    async exec(argv) {
      const r = await ssh(composeArgv(s, null, ['exec', '-T', 'app', ...argv]), { capture: false });
      return r.code ?? 1;
    },
    async fetchLog(file) {
      const r = await ssh(['cat', `${s.dir}/deploy-tasks.log.jsonl`]);
      writeFileSync(file, r.code === 0 ? r.stdout : '');
    },
    async pushLog(file) {
      await must(['tee', `${s.dir}/deploy-tasks.log.jsonl`], 'saving the deploy-task log', { input: readFileSync(file, 'utf8') });
    },
  };
}

async function main(argv) {
  const dash = argv.indexOf('--');
  const { flags, positional } = parseArgs(dash >= 0 ? argv.slice(0, dash) : argv);
  const [command, arg] = positional;
  const remote = createRemote(settings());
  switch (command) {
    case 'deploy':
      if (!flags.image || !flags.sha) throw Object.assign(new Error('deploy needs --image and --sha'), { policy: true });
      await remote.deploy(String(flags.image), String(flags.sha), String(flags.compose ?? 'deploy/compose.host.yaml'));
      process.stdout.write(`✔ deployed ${flags.image}\n`);
      return EXIT.OK;
    case 'rollback': {
      const prev = await remote.rollback();
      process.stdout.write(`✔ rolled back to ${prev.image} (${prev.sha})\n`);
      return EXIT.OK;
    }
    case 'exec':
      return (await remote.exec(dash >= 0 ? argv.slice(dash + 1) : [])) === 0 ? EXIT.OK : EXIT.POLICY;
    case 'fetch-log':
      await remote.fetchLog(arg);
      return EXIT.OK;
    case 'push-log':
      await remote.pushLog(arg);
      return EXIT.OK;
    default:
      process.stderr.write('usage: docker-remote.mjs deploy|rollback|exec|fetch-log|push-log …\n');
      return EXIT.POLICY;
  }
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (err) => {
      process.stderr.write(`docker-remote: ${err.message}\n`);
      process.exitCode = err.policy || /unsafe remote argument|missing environment/.test(err.message) ? EXIT.POLICY : EXIT.TOOL;
    },
  );
}
