#!/usr/bin/env node
// Phase 2 acceptance cell: scaffold one fixture combination through the real CLI, install its
// toolchain, and run the generated repository's own `check` (and the paired tests repository's).
//   node scripts/packs-matrix.mjs <combo> [--profile quick|full] [--work <dir>]
//   node scripts/packs-matrix.mjs --list
// <combo> is a file name (without .json) in packages/templates/fixtures/combos. Exit codes follow
// the toolkit contract: 0 pass, 1 a tool broke, 2 the generated repository failed its own gate.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EXIT, isMain, listFiles, parseArgs } from './guard/lib/common.mjs';
import { run, which } from './guard/lib/proc.mjs';

const COMBOS = 'packages/templates/fixtures/combos';

export function listCombos(root) {
  return readdirSync(path.join(root, COMBOS))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

/** The install commands a rendered repository needs, from the manifests it contains. */
export function installSteps(dir) {
  const steps = [];
  if (existsSync(path.join(dir, 'package.json')))
    steps.push([
      'pnpm',
      existsSync(path.join(dir, 'pnpm-lock.yaml')) ? ['install', '--frozen-lockfile'] : ['install'],
    ]);
  if (existsSync(path.join(dir, 'pyproject.toml'))) steps.push(['uv', ['sync']]);
  if (existsSync(path.join(dir, 'composer.json')))
    steps.push(['composer', ['install', '--no-interaction', '--no-progress']]);
  return steps;
}

async function exec(cmd, args, cwd) {
  const bin = path.isAbsolute(cmd) ? [cmd, []] : which(cmd);
  if (!bin) throw new Error(`${cmd} is not installed`);
  process.stdout.write(`$ ${path.basename(cmd)} ${args.join(' ')}   (in ${path.basename(cwd)})\n`);
  return run(bin[0], [...bin[1], ...args], { cwd });
}

async function must(cmd, args, cwd) {
  const r = await exec(cmd, args, cwd);
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.code}`);
}

async function gitInit(dir) {
  await must('git', ['init', '-q', '-b', 'main'], dir);
  await must('git', ['add', '-A'], dir);
}

async function install(dir, { stage = true } = {}) {
  for (const [cmd, args] of installSteps(dir)) await must(cmd, args, dir);
  if (stage) await must('git', ['add', '-A'], dir);
}

export async function runCell(root, combo, { profile = 'full', work } = {}) {
  const specFile = path.join(root, COMBOS, `${combo}.json`);
  if (!existsSync(specFile)) throw new Error(`unknown combo ${combo} (see --list)`);
  const spec = JSON.parse(readFileSync(specFile, 'utf8'));
  const base = work ? path.resolve(work) : mkdtempSync(path.join(tmpdir(), 'incubator-cell-'));
  const app = path.join(base, spec.project.slug);
  const pairedName =
    spec.testing?.home === 'paired-repo'
      ? (spec.testing.pairedRepo?.name ?? `${spec.project.slug}-tests`)
      : null;
  for (const dir of [app, ...(pairedName ? [path.join(base, pairedName)] : [])])
    rmSync(dir, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const cli = await exec(
    process.execPath,
    [path.join(root, 'apps/cli/bin/incubator.mjs'), 'scaffold', specFile, '--out', app],
    root,
  );
  if (cli.code !== 0) throw new Error(`incubator scaffold exited ${cli.code}`);
  const results = [];
  await gitInit(app);
  await install(app);
  results.push(['app', (await exec(process.execPath, ['scripts/check.mjs', profile], app)).code]);
  if (pairedName) {
    const tests = path.join(base, pairedName);
    // The tests repository runs against the application checked out at app/ (as its CI does).
    for (const f of listFiles(app)) {
      mkdirSync(path.dirname(path.join(tests, 'app', f)), { recursive: true });
      cpSync(path.join(app, f), path.join(tests, 'app', f));
    }
    await install(path.join(tests, 'app'), { stage: false });
    await gitInit(tests);
    await install(tests);
    results.push([
      'tests',
      (await exec(process.execPath, ['scripts/check.mjs', profile], tests)).code,
    ]);
  }
  return results;
}

if (isMain(import.meta.url)) {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  if (flags.list) {
    process.stdout.write(`${JSON.stringify(listCombos(root))}\n`);
  } else if (!positional[0]) {
    process.stderr.write(
      'usage: packs-matrix.mjs <combo> [--profile quick|full] [--work <dir>] | --list\n',
    );
    process.exitCode = EXIT.POLICY;
  } else {
    runCell(root, positional[0], {
      profile: String(flags.profile ?? 'full'),
      work: flags.work,
    }).then(
      (results) => {
        for (const [where, code] of results)
          process.stdout.write(
            `${code === 0 ? '✔' : '✖'} ${positional[0]} ${where}: check exit ${code}\n`,
          );
        process.exitCode = results.every(([, c]) => c === 0) ? EXIT.OK : EXIT.POLICY;
      },
      (err) => {
        process.stderr.write(`packs-matrix: ${err.message}\n`);
        process.exitCode = EXIT.TOOL;
      },
    );
  }
}
