#!/usr/bin/env node
// Scaffolding completeness score (ADR-018):
// score = max(0, 100 − w.missingRequired·missing − min(w.todoCap, w.todo·todos) − w.emptyProfile·empty − w.drift·drift)
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  EXIT,
  isMain,
  listFiles,
  matchesAny,
  readJson,
  readText,
  runGuard,
} from './lib/common.mjs';
import { checkDrift } from './drift.mjs';
import { checkScenarios, emptyProfiles } from './scenarios.mjs';

const MARKER = ['TODO', '(scaffold)'].join('');

export function computeScore(root) {
  const cfg = readJson(root, 'config/completeness.json');
  const w = cfg.weights;
  const files = listFiles(root);
  const missing = cfg.required.filter(
    (item) =>
      !item.anyOf.some(
        (g) => files.some((f) => matchesAny(f, [g])) || existsSync(path.join(root, g)),
      ),
  );
  const todos = [];
  for (const f of files) {
    if (matchesAny(f, cfg.todoExclude ?? [])) continue;
    const text = readText(root, f);
    if (text === null) continue;
    text.split('\n').forEach((line, i) => {
      if (line.includes(MARKER)) todos.push(`${f}:${i + 1}`);
    });
  }
  const { scenarios, profilesCfg } = checkScenarios(root);
  const empty = emptyProfiles(scenarios, profilesCfg);
  const drift = checkDrift(root, files);
  const deductions = {
    missingRequired: w.missingRequired * missing.length,
    todo: Math.min(w.todoCap, w.todo * todos.length),
    emptyProfiles: w.emptyProfile * empty.length,
    drift: w.drift * drift.length,
  };
  const score = Math.max(0, 100 - Object.values(deductions).reduce((a, b) => a + b, 0));
  const spec = readJson(root, 'incubator.json', null);
  const threshold = spec?.testing?.completenessThreshold ?? cfg.threshold;
  return { score, threshold, deductions, missing: missing.map((m) => m.id), todos, empty, drift };
}

if (isMain(import.meta.url)) {
  runGuard(({ flags }) => {
    const r = computeScore(process.cwd());
    if (flags.json) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    const ok = r.score >= r.threshold;
    process.stdout.write(
      `${ok ? '✔' : '✖'} completeness: ${r.score}/100 (threshold ${r.threshold})\n`,
    );
    if (flags.explain || !ok) {
      for (const [k, v] of Object.entries(r.deductions))
        if (v) process.stdout.write(`  −${v} ${k}\n`);
      for (const m of r.missing) process.stdout.write(`  missing required: ${m}\n`);
      for (const t of r.todos.slice(0, 50)) process.stdout.write(`  todo: ${t}\n`);
      for (const e of r.empty) process.stdout.write(`  empty profile: ${e}\n`);
      for (const d of r.drift) process.stdout.write(`  drift: ${d}\n`);
    }
    return ok ? EXIT.OK : EXIT.POLICY;
  });
}
