#!/usr/bin/env node
// Runs Composer without a shell on every OS (the `audit` check step): `composer` on PATH, or on
// Windows `php composer.phar` next to the composer.bat shim. Exit 0 pass, 1 Composer missing or
// killed, 2 Composer reported a finding (any non-zero exit, e.g. `composer audit` advisories).
//   node scripts/php/composer.mjs audit --no-interaction
import { existsSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain } from '../guard/lib/common.mjs';
import { run, which } from '../guard/lib/proc.mjs';

export function composerCommand(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
    for (const dir of dirs) {
      const phar = path.join(dir, 'composer.phar');
      if (existsSync(phar)) {
        const php = which('php', env);
        return php ? [php[0], [...php[1], phar]] : null;
      }
    }
  }
  return which('composer', env);
}

async function main() {
  const cmd = composerCommand();
  if (!cmd) {
    process.stderr.write('composer is not on PATH (https://getcomposer.org/download/)\n');
    return EXIT.TOOL;
  }
  const r = await run(cmd[0], [...cmd[1], ...process.argv.slice(2)], { cwd: process.cwd() });
  if (r.code === null) return EXIT.TOOL;
  return r.code === 0 ? EXIT.OK : EXIT.POLICY;
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => (process.exitCode = code),
    (err) => {
      process.stderr.write(`composer: ${err.message}\n`);
      process.exitCode = EXIT.TOOL;
    },
  );
}
