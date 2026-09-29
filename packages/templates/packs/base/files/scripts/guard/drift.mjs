#!/usr/bin/env node
// Drift checker: agent instruction files share one body; scaffold markers are well formed;
// every registry entry maps to code and every code artifact maps back to a registry entry.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isMain, listFiles, readJson, readText, report, runGuard } from './lib/common.mjs';
import { regionBody, scanMarkers } from './lib/markers.mjs';

export function checkDrift(root, files = listFiles(root)) {
  const config = readJson(root, 'config/drift.json');
  const findings = [];

  const bodies = [];
  for (const f of config.agentFiles ?? []) {
    const text = readText(root, f);
    if (text === null) {
      findings.push(`${f}: agent instruction file is missing`);
      continue;
    }
    const body = regionBody(text, 'agent-instructions');
    if (body === null) findings.push(`${f}: missing the agent-instructions scaffold region`);
    else bodies.push([f, createHash('sha256').update(body).digest('hex')]);
  }
  if (new Set(bodies.map(([, h]) => h)).size > 1) {
    findings.push(
      `agent instruction bodies differ: ${bodies.map(([f, h]) => `${f}=${h.slice(0, 8)}`).join(', ')}`,
    );
  }

  for (const f of files) {
    const text = readText(root, f);
    if (text === null || !text.includes('scaffold:')) continue;
    for (const e of scanMarkers(text).errors) findings.push(`${f}: ${e}`);
  }

  for (const reg of config.registries ?? []) {
    const data = readJson(root, reg.file);
    const list = reg.list.split('.').reduce((o, k) => o?.[k], data) ?? [];
    const ids = list.map((e) => (typeof e === 'string' ? e : e[reg.key ?? 'id']));
    for (const id of ids) {
      for (const pattern of reg.expect ?? []) {
        const rel = expandId(pattern, id);
        if (!existsSync(path.join(root, rel))) findings.push(`${reg.name}: "${id}" expects ${rel}`);
      }
    }
    if (reg.reverse) {
      const re = new RegExp(reg.reverse);
      const found = new Set(files.map((f) => re.exec(f)?.[1]).filter(Boolean));
      for (const id of found)
        if (!ids.includes(id))
          findings.push(`${reg.name}: "${id}" exists in code but not in ${reg.file}`);
    }
  }
  return findings;
}

/** Registry path patterns: `{id}` as is, `{id_snake}`, `{id_pascal}` and `{id_camel}` for language layouts. */
export function expandId(pattern, id) {
  const words = String(id)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
  return pattern
    .replaceAll('{id_snake}', words.map((w) => w.toLowerCase()).join('_'))
    .replaceAll('{id_pascal}', pascal)
    .replaceAll('{id_camel}', pascal ? pascal[0].toLowerCase() + pascal.slice(1) : '')
    .replaceAll('{id}', id);
}

if (isMain(import.meta.url)) {
  runGuard(({ flags }) => report('drift', checkDrift(process.cwd()), { quiet: flags.quiet }));
}
