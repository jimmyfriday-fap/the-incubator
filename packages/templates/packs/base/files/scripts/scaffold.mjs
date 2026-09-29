#!/usr/bin/env node
// The repository's own scaffolder (TDD §3.5): adds a feature from config/scaffold.json blueprints,
// registers it through scaffold markers and config/features.json, and writes the four onboarding
// scenario stubs (status "todo"). Anything left for an agent is marked TODO(scaffold).
//   node scripts/scaffold.mjs feature <id> --summary "…" [--lane enhancement/new] [--dry-run] [--validate-only] [--out <dir>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain, parseArgs, readJson } from './guard/lib/common.mjs';
import { applyMarkerPatch } from './guard/lib/markers.mjs';

const words = (s) => s.split(/[^A-Za-z0-9]+/).filter(Boolean);
export function placeholders(id, summary, lane) {
  const w = words(id);
  const pascal = w.map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join('');
  return {
    FEATURE_ID: id,
    FEATURE_PASCAL: pascal,
    FEATURE_CAMEL: pascal[0].toLowerCase() + pascal.slice(1),
    FEATURE_SNAKE: w.map((x) => x.toLowerCase()).join('_'),
    FEATURE_SUMMARY: summary.replace(/[\r\n]+/g, ' ').trim(),
    FEATURE_LANE: lane,
  };
}

export function fill(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function scenarioStubs(id) {
  const stub = (sid, tag, title) => ({
    id: sid,
    feature: id,
    title: `TODO(scaffold): ${title}`,
    status: 'todo',
    tags: [tag],
    seed: {},
    context: {},
    mocks: { ai: [] },
    stages: [{ name: 'todo', input: {}, assertions: [{ path: 'status', op: 'exists' }] }],
  });
  return [
    stub('happy-path', 'happy', 'the main success path'),
    stub('validation-missing-input', 'validation', 'rejects missing input'),
    stub('validation-bad-input', 'validation', 'rejects malformed input'),
    stub('fault-dependency-down', 'fault', 'degrades when a dependency fails'),
  ];
}

/** Computes every change without touching the disk: [{ path, content, kind }]. */
export function planFeature(root, { id, summary, lane }) {
  const errors = [];
  if (!/^[a-z][a-z0-9-]{0,48}$/.test(id)) errors.push(`feature id "${id}" must be kebab-case`);
  if (!summary) errors.push('--summary is required');
  const features = readJson(root, 'config/features.json');
  if (features.features.some((f) => f.id === id)) errors.push(`feature "${id}" already exists`);
  const cfg = readJson(root, 'config/scaffold.json', { feature: { files: [], markers: [] } });
  const vars = placeholders(id, summary, lane);
  const changes = [];
  for (const f of cfg.feature.files ?? []) {
    const dest = fill(f.dest, vars);
    if (existsSync(path.join(root, dest))) errors.push(`${dest} already exists`);
    changes.push({
      path: dest,
      content: fill(readFileSync(path.join(root, f.template), 'utf8'), vars),
      kind: 'create',
    });
  }
  for (const s of scenarioStubs(id))
    changes.push({
      path: `tests/scenarios/${id}/${s.id}.json`,
      content: `${JSON.stringify(s, null, 2)}\n`,
      kind: 'create',
    });
  const byFile = new Map();
  for (const m of cfg.feature.markers ?? []) {
    const current = byFile.get(m.file) ?? readFileSync(path.join(root, m.file), 'utf8');
    const text = fill(
      m.template ? readFileSync(path.join(root, m.template), 'utf8') : m.text,
      vars,
    );
    byFile.set(m.file, applyMarkerPatch(m.file, current, m.region, [{ id, text }]));
  }
  for (const [file, content] of byFile) changes.push({ path: file, content, kind: 'patch' });
  const next = {
    ...features,
    features: [...features.features, { id, summary: vars.FEATURE_SUMMARY }],
  };
  changes.push({
    path: 'config/features.json',
    content: `${JSON.stringify(next, null, 2)}\n`,
    kind: 'patch',
  });
  const tracker = readJson(root, '.incubator/tracker.json', { type: 'local' });
  if (tracker.type === 'local') {
    const ticket = {
      id: `F-${id}`,
      title: vars.FEATURE_SUMMARY,
      lane,
      state: 'NEW',
      plan: null,
      remediations: [],
    };
    changes.push({
      path: `${tracker.ticketsDir ?? '.incubator/tickets'}/F-${id}.json`,
      content: `${JSON.stringify(ticket, null, 2)}\n`,
      kind: 'create',
    });
  }
  return { errors, changes };
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [kind, id] = positional;
  const root = process.cwd();
  if (kind !== 'feature' || !id) {
    process.stderr.write(
      'usage: scaffold.mjs feature <id> --summary "…" [--lane <lane>] [--dry-run] [--validate-only] [--out <dir>]\n',
    );
    return EXIT.POLICY;
  }
  const { errors, changes } = planFeature(root, {
    id,
    summary: String(flags.summary ?? ''),
    lane: String(flags.lane ?? 'enhancement/new'),
  });
  if (errors.length) {
    for (const e of errors) process.stderr.write(`✖ ${e}\n`);
    return EXIT.POLICY;
  }
  if (flags['validate-only']) {
    process.stdout.write(`✔ feature ${id} can be scaffolded (${changes.length} change(s))\n`);
    return EXIT.OK;
  }
  const out = typeof flags.out === 'string' ? path.resolve(flags.out) : root;
  for (const c of changes) {
    process.stdout.write(`${flags['dry-run'] ? '•' : '✔'} ${c.kind.padEnd(6)} ${c.path}\n`);
    if (flags['dry-run']) continue;
    mkdirSync(path.dirname(path.join(out, c.path)), { recursive: true });
    writeFileSync(path.join(out, c.path), c.content);
  }
  if (!flags['dry-run'])
    process.stdout.write(
      'next: fill every TODO(scaffold) marker, then run node scripts/check.mjs quick\n',
    );
  return EXIT.OK;
}

if (isMain(import.meta.url)) {
  main().then(
    (c) => (process.exitCode = c),
    (e) => {
      process.stderr.write(`scaffold: ${e.message}\n`);
      process.exitCode = EXIT.TOOL;
    },
  );
}
