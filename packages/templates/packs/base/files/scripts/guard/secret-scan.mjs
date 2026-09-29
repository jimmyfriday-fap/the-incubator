#!/usr/bin/env node
// Secret scan of the working tree with the hash-pinned gitleaks (`gitleaks dir`, redacted), so a
// leaked or look-alike secret fails locally before CI's history scan sees it. Uses .gitleaks.toml
// when present. Exit 2 on findings, 1 when gitleaks is not installed (run tools-fetch first).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GuardToolError, isMain, report, runGuard } from './lib/common.mjs';
import { run } from './lib/proc.mjs';
import { toolCommand } from './lib/tools.mjs';

export function formatLeaks(leaks) {
  return leaks.map((l) => `${l.File}:${l.StartLine} ${l.RuleID}`);
}

if (isMain(import.meta.url)) {
  runGuard(async ({ flags }) => {
    const root = process.cwd();
    const bin = toolCommand(root, 'gitleaks');
    if (!bin)
      throw new GuardToolError('gitleaks is not installed (run: node scripts/tools-fetch.mjs)');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'secret-scan-'));
    const out = path.join(tmp, 'gitleaks.json');
    try {
      const r = await run(
        bin[0],
        [
          ...bin[1],
          'dir',
          '--no-banner',
          '--redact',
          '--report-format',
          'json',
          '--report-path',
          out,
          '--exit-code',
          '0',
          '.',
        ],
        { cwd: root, capture: true },
      );
      if (r.code !== 0)
        throw new GuardToolError(`gitleaks failed: ${r.stderr.trim().split('\n').pop()}`);
      return report('secret-scan', formatLeaks(JSON.parse(readFileSync(out, 'utf8'))), {
        quiet: flags.quiet,
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}
