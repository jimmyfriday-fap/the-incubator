#!/usr/bin/env node
// Post-deploy tasks from .deploy-tasks.json. Dry run unless --yes. Every result is appended to a
// JSONL log keyed by (name, env, sha) so staging/prod gaps are visible with --report.
//   node scripts/run-deploy-tasks.mjs --env staging --sha <sha> [--log deploy-tasks.log.jsonl] [--yes]
//   node scripts/run-deploy-tasks.mjs --report [--log …]
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain, parseArgs, readJson } from './guard/lib/common.mjs';
import { run, which } from './guard/lib/proc.mjs';

export function validateTasks(doc) {
  const errors = [];
  if (!doc || !Array.isArray(doc.tasks)) return ['.deploy-tasks.json needs a "tasks" array'];
  const names = new Set();
  doc.tasks.forEach((t, i) => {
    const where = `tasks[${i}] (${t?.name ?? '?'})`;
    if (typeof t.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(t.name))
      errors.push(`${where}: name must be kebab-case`);
    if (names.has(t.name)) errors.push(`${where}: duplicate name`);
    names.add(t.name);
    if (
      !Array.isArray(t.env) ||
      t.env.length === 0 ||
      t.env.some((e) => !['staging', 'prod'].includes(e))
    )
      errors.push(`${where}: env must list staging and/or prod`);
    for (const k of ['idempotent', 'runOnce'])
      if (typeof t[k] !== 'boolean') errors.push(`${where}: ${k} must be a boolean`);
    if (!Number.isInteger(t.timeout) || t.timeout < 1)
      errors.push(`${where}: timeout must be a positive integer (seconds)`);
    if (
      !Array.isArray(t.command) ||
      t.command.length === 0 ||
      t.command.some((c) => typeof c !== 'string')
    )
      errors.push(`${where}: command must be an argv array`);
  });
  return errors;
}

export function readLog(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Which tasks to run for (env, sha), and why the others are skipped. */
export function plan(tasks, log, env, sha) {
  return tasks
    .filter((t) => t.env.includes(env))
    .map((t) => {
      const ok = log.filter((e) => e.name === t.name && e.env === env && e.status === 'ok');
      if (t.runOnce && ok.length)
        return {
          task: t,
          action: 'skip',
          why: `runOnce: already ran on ${env} at ${ok[0].sha.slice(0, 7)}`,
        };
      if (ok.some((e) => e.sha === sha))
        return { task: t, action: 'skip', why: `already ran on ${env} at this sha` };
      return {
        task: t,
        action: 'run',
        why: t.idempotent ? 'idempotent' : 'first run for this sha',
      };
    });
}

/** Tasks that ran on staging at a sha but not on prod at the same sha. */
export function gaps(log) {
  const key = (e) => `${e.name}@${e.sha}`;
  const prod = new Set(log.filter((e) => e.env === 'prod' && e.status === 'ok').map(key));
  return [
    ...new Set(
      log.filter((e) => e.env === 'staging' && e.status === 'ok' && !prod.has(key(e))).map(key),
    ),
  ].sort();
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const logFile = path.resolve(root, String(flags.log ?? 'deploy-tasks.log.jsonl'));
  const doc = readJson(root, '.deploy-tasks.json');
  const errors = validateTasks(doc);
  if (errors.length) {
    for (const e of errors) process.stderr.write(`✖ ${e}\n`);
    return EXIT.POLICY;
  }
  const log = readLog(logFile);
  if (flags.report) {
    const g = gaps(log);
    process.stdout.write(
      g.length
        ? `ran on staging but not on prod:\n${g.map((x) => `  - ${x}`).join('\n')}\n`
        : 'no staging/prod gaps\n',
    );
    return EXIT.OK;
  }
  const env = String(flags.env ?? '');
  const sha = String(flags.sha ?? '');
  if (!['staging', 'prod'].includes(env) || !/^[0-9a-f]{7,40}$/.test(sha)) {
    process.stderr.write(
      'usage: run-deploy-tasks.mjs --env staging|prod --sha <git sha> [--yes] [--log file] | --report\n',
    );
    return EXIT.POLICY;
  }
  const steps = plan(doc.tasks, log, env, sha);
  let failed = 0;
  for (const s of steps) {
    process.stdout.write(
      `${s.action === 'run' ? (flags.yes ? '▶' : '•') : '-'} ${s.task.name} (${s.why})\n`,
    );
    if (s.action !== 'run' || !flags.yes) continue;
    const bin = which(s.task.command[0]) ?? [s.task.command[0], []];
    const started = Date.now();
    const r = await run(bin[0], [...bin[1], ...s.task.command.slice(1)], {
      cwd: root,
      timeoutMs: s.task.timeout * 1000,
    });
    const status = r.code === 0 ? 'ok' : 'failed';
    if (status !== 'ok') failed++;
    appendFileSync(
      logFile,
      `${JSON.stringify({ name: s.task.name, env, sha, status, exitCode: r.code, at: new Date(started).toISOString(), durationMs: Date.now() - started })}\n`,
    );
  }
  if (!flags.yes) process.stdout.write('dry run: nothing executed (add --yes)\n');
  return failed ? EXIT.POLICY : EXIT.OK;
}

if (isMain(import.meta.url)) {
  main().then(
    (c) => (process.exitCode = c),
    (e) => {
      process.stderr.write(`run-deploy-tasks: ${e.message}\n`);
      process.exitCode = EXIT.TOOL;
    },
  );
}
