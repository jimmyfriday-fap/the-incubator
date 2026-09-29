#!/usr/bin/env node
// Syntax lint: `node --check` for JS modules, `php -l` for PHP, `python -m py_compile` for Python.
import { EXIT, isMain, listFiles, report, runGuard } from './lib/common.mjs';
import { run, which } from './lib/proc.mjs';

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        out.push(await fn(item));
      }
    }),
  );
  return out;
}

export async function checkSyntax(root, files) {
  const findings = [];
  const js = files.filter((f) => /\.(?:mjs|cjs|js)$/.test(f));
  const php = files.filter((f) => f.endsWith('.php'));
  const py = files.filter((f) => f.endsWith('.py'));
  const missingTools = [];
  const results = await pool(js, 8, async (f) => [
    f,
    await run(process.execPath, ['--check', f], { cwd: root, capture: true }),
  ]);
  for (const [f, r] of results)
    if (r.code !== 0) findings.push(`${f}: ${r.stderr.trim().split('\n').slice(0, 3).join(' | ')}`);
  if (php.length) {
    const bin = which('php');
    if (!bin) missingTools.push('php');
    else
      for (const [f, r] of await pool(php, 8, async (f) => [
        f,
        await run(bin[0], [...bin[1], '-l', f], { cwd: root, capture: true }),
      ])) {
        if (r.code !== 0) findings.push(`${f}: ${(r.stdout + r.stderr).trim().split('\n')[0]}`);
      }
  }
  if (py.length) {
    const bin = which('python3') ?? which('python');
    if (!bin) missingTools.push('python');
    else {
      const r = await run(bin[0], [...bin[1], '-m', 'py_compile', ...py], {
        cwd: root,
        capture: true,
      });
      if (r.code !== 0) findings.push(`python: ${r.stderr.trim().split('\n').slice(-1)[0]}`);
    }
  }
  return { findings, missingTools };
}

if (isMain(import.meta.url)) {
  runGuard(async ({ flags }) => {
    const root = process.cwd();
    const { findings, missingTools } = await checkSyntax(root, listFiles(root));
    if (missingTools.length) {
      process.stderr.write(`syntax: required tool(s) not on PATH: ${missingTools.join(', ')}\n`);
      return EXIT.TOOL;
    }
    return report('syntax', findings, { quiet: flags.quiet });
  });
}
