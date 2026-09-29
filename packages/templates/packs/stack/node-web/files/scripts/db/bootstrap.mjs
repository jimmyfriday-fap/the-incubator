#!/usr/bin/env node
// Builds the database from scratch: base schema, then every numbered migration (once), then seed.
//   node scripts/db/bootstrap.mjs [--reset] [--migrate-only]
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const args = new Set(process.argv.slice(2));
const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write('DATABASE_URL is not set (see .env.example)\n');
  process.exitCode = 1;
} else {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (args.has('--reset')) {
      if (process.env.APP_ENV === 'prod') throw new Error('refusing to reset a production database');
      await client.query('drop schema public cascade; create schema public;');
    }
    await client.query('create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())');
    await client.query(readFileSync('db/schema/base.sql', 'utf8'));
    const done = new Set((await client.query('select name from _migrations')).rows.map((r) => r.name));
    for (const file of readdirSync('db/migrations').filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
      if (done.has(file)) continue;
      await client.query('begin');
      await client.query(readFileSync(path.join('db/migrations', file), 'utf8'));
      await client.query('insert into _migrations (name) values ($1)', [file]);
      await client.query('commit');
      process.stdout.write(`applied ${file}\n`);
    }
    if (!args.has('--migrate-only') && process.env.APP_ENV !== 'prod') {
      for (const file of readdirSync('db/seed').filter((f) => f.endsWith('.sql')).sort()) {
        await client.query(readFileSync(path.join('db/seed', file), 'utf8'));
      }
    }
    process.stdout.write('database ready\n');
  } finally {
    await client.end();
  }
}
