#!/usr/bin/env node
// Dogfood: copies the Incubator's own guard toolkit, scripts, schemas and tool locks into the template
// packs verbatim. `--check` exits 2 when a pack copy differs from the repository (the drift test).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain, parseArgs } from './guard/lib/common.mjs';

const PACKS = 'packages/templates/packs';

/** [repo path, pack-relative destination] */
export function syncPlan(root) {
  const plan = [];
  const add = (src, pack, dest = src) => plan.push([src, `${PACKS}/${pack}/files/${dest}`]);
  for (const f of readdirSync(path.join(root, 'scripts/guard'))) {
    if (f.endsWith('.mjs') && !f.endsWith('.test.mjs') && f !== 'deps-boundary.mjs')
      add(`scripts/guard/${f}`, 'base');
  }
  for (const f of readdirSync(path.join(root, 'scripts/guard/lib')))
    add(`scripts/guard/lib/${f}`, 'base');
  for (const f of [
    'check.mjs',
    'tools-fetch.mjs',
    'test-profile.mjs',
    'run-deploy-tasks.mjs',
    'scaffold.mjs',
  ])
    add(`scripts/${f}`, 'base');
  for (const f of ['session-start.mjs', 'on-stop.mjs', 'tracker.mjs', 'sync-instructions.mjs'])
    add(`scripts/agent/${f}`, 'base');
  for (const f of ['scenario.schema.json', 'agent-profile.schema.json', 'deploy-tasks.schema.json'])
    add(`schemas/${f}`, 'base');
  for (const f of ['tools.lock.json', 'semgrep-requirements.txt', 'semgrep.in'])
    add(`tools/${f}`, 'base');
  add('.claude/settings.json', 'base');
  add('.gitattributes', 'base');
  add('.editorconfig', 'base');
  for (const pack of ['stack/node-web', 'stack/node-lib']) {
    for (const f of readdirSync(path.join(root, 'security/rules')))
      add(`security/rules/${f}`, pack);
    for (const rule of readdirSync(path.join(root, 'security/fixtures'))) {
      for (const f of readdirSync(path.join(root, 'security/fixtures', rule)))
        add(`security/fixtures/${rule}/${f}`, pack);
    }
  }
  return plan;
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  let stale = 0;
  for (const [src, dest] of syncPlan(root)) {
    const want = readFileSync(path.join(root, src));
    const have = existsSync(path.join(root, dest)) ? readFileSync(path.join(root, dest)) : null;
    if (have && have.equals(want)) continue;
    stale++;
    if (flags.check) process.stdout.write(`stale pack copy: ${dest} (from ${src})\n`);
    else {
      mkdirSync(path.dirname(path.join(root, dest)), { recursive: true });
      writeFileSync(path.join(root, dest), want);
    }
  }
  process.stdout.write(flags.check ? `${stale} stale\n` : `synced ${stale} file(s)\n`);
  process.exitCode = flags.check && stale ? EXIT.POLICY : EXIT.OK;
}
