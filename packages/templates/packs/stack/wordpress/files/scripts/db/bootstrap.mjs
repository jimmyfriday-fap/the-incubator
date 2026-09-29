#!/usr/bin/env node
// WordPress database bootstrap (the deploy task `migrate-db` runs it with --migrate-only).
// WordPress core owns its schema, and plugins create tables with dbDelta on activation, so the only
// thing to apply here is numbered SQL in db/migrations/NNNN_name.sql: once each, in order, through
// WP-CLI, recorded in the `_migrations` table. With no migrations this is a no-op and exits 0.
//   node scripts/db/bootstrap.mjs [--migrate-only] [--dry-run]
// Environment: WP_CLI  the wp command as a JSON array (default ["wp"]), for example
//                      ["docker","compose","run","--rm","-T","cli","wp"];
//              WP_PATH the WordPress root, passed as --path (optional).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain } from '../guard/lib/common.mjs';

const DIR = 'db/migrations';
const NAME = /^\d{4}_[a-z0-9_-]+\.sql$/;

export function pendingMigrations(dir = DIR) {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => NAME.test(f))
        .sort()
    : [];
}

export function wpCommand(env = process.env) {
  const raw = env.WP_CLI;
  const cmd = raw ? JSON.parse(raw) : ['wp'];
  if (!Array.isArray(cmd) || cmd.length === 0 || !cmd.every((x) => typeof x === 'string'))
    throw new Error('WP_CLI must be a JSON array of strings, e.g. ["wp"]');
  return [...cmd, ...(env.WP_PATH ? [`--path=${env.WP_PATH}`] : [])];
}

function wp(cmd, args, input) {
  const r = spawnSync(cmd[0], [...cmd.slice(1), ...args], {
    input,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (r.error) throw new Error(`cannot run ${cmd[0]}: ${r.error.message}`);
  return r;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const files = pendingMigrations();
  if (files.length === 0) {
    process.stdout.write(
      `no migrations in ${DIR}/: WordPress core and plugin activation (dbDelta) own the schema\n`,
    );
    return EXIT.OK;
  }
  const cmd = wpCommand();
  if (args.has('--dry-run')) {
    for (const f of files) process.stdout.write(`• would apply ${f} (unless already recorded)\n`);
    return EXIT.OK;
  }
  if (wp(cmd, ['core', 'is-installed']).status !== 0) {
    process.stderr.write('WordPress is not installed yet; run `wp core install` first\n');
    return EXIT.TOOL;
  }
  const create =
    'CREATE TABLE IF NOT EXISTS _migrations (name VARCHAR(191) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)';
  if (wp(cmd, ['db', 'query', create]).status !== 0) return EXIT.TOOL;
  const listed = wp(cmd, ['db', 'query', 'SELECT name FROM _migrations', '--skip-column-names']);
  if (listed.status !== 0) return EXIT.TOOL;
  const done = new Set(listed.stdout.split('\n').map((l) => l.trim()));
  for (const f of files) {
    if (done.has(f)) continue;
    const applied = wp(cmd, ['db', 'query'], readFileSync(path.join(DIR, f), 'utf8'));
    if (applied.status !== 0) {
      process.stderr.write(`✖ ${f}: ${applied.stderr.trim()}\n`);
      return EXIT.TOOL;
    }
    // The file name matched NAME above, so it is safe inside a quoted SQL literal.
    wp(cmd, ['db', 'query', `INSERT INTO _migrations (name) VALUES ('${f}')`]);
    process.stdout.write(`applied ${f}\n`);
  }
  process.stdout.write('database ready\n');
  return EXIT.OK;
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (e) {
    process.stderr.write(`db bootstrap: ${e.message}\n`);
    process.exitCode = EXIT.TOOL;
  }
}
