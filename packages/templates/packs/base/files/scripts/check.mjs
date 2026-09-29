#!/usr/bin/env node
// Runs a check profile from config/checks.json. Every step runs (so every problem is reported),
// then the result follows the exit-code contract: any tool breakage → 1, else any finding → 2, else 0.
import { EXIT, isMain, parseArgs, readJson } from './guard/lib/common.mjs';
import { nodeBin, packageManager, run, which } from './guard/lib/proc.mjs';

export function resolveStep(root, step) {
  if (step.guard)
    return {
      argv: [process.execPath, [`scripts/guard/${step.guard}.mjs`, ...(step.args ?? [])]],
      contract: true,
    };
  if (step.script)
    return { argv: [process.execPath, [step.script, ...(step.args ?? [])]], contract: true };
  if (step.nodeBin) {
    const bin = nodeBin(root, step.nodeBin[0], step.nodeBin[1]);
    return bin
      ? { argv: [bin[0], [...bin[1], ...(step.args ?? [])]], contract: false }
      : { missing: `node package ${step.nodeBin[0]}` };
  }
  if (step.pm) {
    const pm = packageManager(step.pmName ?? 'pnpm');
    return pm
      ? { argv: [pm[0], [...pm[1], ...step.pm]], contract: false }
      : { missing: 'package manager' };
  }
  if (step.cmd) {
    const bin = which(step.cmd[0]);
    return bin
      ? { argv: [bin[0], [...bin[1], ...step.cmd.slice(1)]], contract: false }
      : { missing: step.cmd[0] };
  }
  return { missing: 'step has no guard/script/nodeBin/pm/cmd' };
}

/** Maps a step's process exit to the contract. External tools report findings with any non-zero code. */
export function classify(code, contract) {
  if (code === 0) return 'pass';
  if (code === null) return 'broke';
  if (contract)
    return code === EXIT.POLICY ? 'fail' : code === EXIT.INTERRUPTED ? 'interrupted' : 'broke';
  return 'fail';
}

export function overall(results) {
  if (results.some((r) => r.status === 'interrupted')) return EXIT.INTERRUPTED;
  if (results.some((r) => r.status === 'broke')) return EXIT.TOOL;
  if (results.some((r) => r.status === 'fail')) return EXIT.POLICY;
  return EXIT.OK;
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const cfg = readJson(root, 'config/checks.json');
  const profile = positional[0] ?? 'quick';
  let ids = cfg.profiles[profile];
  if (!ids) {
    process.stderr.write(
      `unknown check profile "${profile}" (have: ${Object.keys(cfg.profiles).join(', ')})\n`,
    );
    return EXIT.POLICY;
  }
  if (typeof flags.only === 'string') ids = ids.filter((id) => flags.only.split(',').includes(id));
  if (typeof flags.skip === 'string') ids = ids.filter((id) => !flags.skip.split(',').includes(id));
  const results = [];
  let interrupted = false;
  process.on('SIGINT', () => (interrupted = true));
  for (const id of ids) {
    if (interrupted) break;
    const step = cfg.steps[id];
    const started = Date.now();
    process.stdout.write(`\n▶ ${id}\n`);
    if (!step) {
      results.push({ id, status: 'broke', ms: 0, note: 'undefined step' });
      continue;
    }
    const resolved = resolveStep(root, step);
    if (resolved.missing) {
      results.push({ id, status: 'broke', ms: 0, note: `missing ${resolved.missing}` });
      continue;
    }
    const r = await run(resolved.argv[0], resolved.argv[1], { cwd: root, env: step.env });
    results.push({
      id,
      status: interrupted ? 'interrupted' : classify(r.code, resolved.contract),
      ms: Date.now() - started,
      note: r.error?.message ?? '',
    });
  }
  const icon = { pass: '✔', fail: '✖', broke: '💥', interrupted: '⏹' };
  process.stdout.write(`\n── check ${profile} ──\n`);
  for (const r of results)
    process.stdout.write(
      `${icon[r.status]} ${r.id.padEnd(20)} ${r.status.padEnd(11)} ${(r.ms / 1000).toFixed(1)}s ${r.note}\n`,
    );
  const code = overall(results);
  process.stdout.write(`exit ${code}\n`);
  return code;
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => (process.exitCode = code),
    (err) => {
      process.stderr.write(`check error: ${err.message}\n`);
      process.exitCode = EXIT.TOOL;
    },
  );
}
