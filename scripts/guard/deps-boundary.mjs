#!/usr/bin/env node
// Enforces the declared workspace package graph (config/deps-boundary.json) and rejects cycles.
import path from 'node:path';
import { isMain, listFiles, readJson, readText, report, runGuard } from './lib/common.mjs';

export function checkBoundaries(root) {
  const config = readJson(root, 'config/deps-boundary.json');
  const allowed = config.packages;
  const findings = [];
  const nameToDir = new Map();
  for (const dir of Object.keys(allowed)) {
    const pj = readJson(root, `${dir}/package.json`, null);
    if (!pj) {
      findings.push(`${dir}: declared in deps-boundary.json but has no package.json`);
      continue;
    }
    nameToDir.set(pj.name, dir);
  }
  // Declared graph must be acyclic.
  const state = new Map();
  const visit = (dir, stack) => {
    if (state.get(dir) === 'done') return;
    if (state.get(dir) === 'active') {
      findings.push(`cycle: ${[...stack, dir].join(' → ')}`);
      return;
    }
    state.set(dir, 'active');
    for (const dep of allowed[dir] ?? []) visit(dep, [...stack, dir]);
    state.set(dir, 'done');
  };
  for (const dir of Object.keys(allowed)) visit(dir, []);

  const files = listFiles(root);
  for (const [name, dir] of nameToDir) {
    const pj = readJson(root, `${dir}/package.json`);
    const deps = { ...pj.dependencies, ...pj.devDependencies, ...pj.peerDependencies };
    for (const depName of Object.keys(deps)) {
      const depDir = nameToDir.get(depName);
      if (depDir && !(allowed[dir] ?? []).includes(depDir)) {
        findings.push(
          `${name}: depends on ${depName} (${depDir}) which the boundary does not allow`,
        );
      }
    }
    const declared = new Set(Object.keys(deps));
    for (const f of files) {
      if (!f.startsWith(`${dir}/src/`) || !/\.(?:[cm]?[jt]sx?)$/.test(f)) continue;
      const text = readText(root, f) ?? '';
      for (const m of text.matchAll(
        /(?:from\s*|import\s*\(\s*|import\s+)['"](@[^/'"]+\/[^/'"]+)[^'"]*['"]/g,
      )) {
        const imported = m[1];
        if (nameToDir.has(imported) && imported !== name && !declared.has(imported)) {
          findings.push(
            `${f}: imports ${imported} without declaring it in ${path.posix.join(dir, 'package.json')}`,
          );
        }
      }
    }
  }
  return findings;
}

if (isMain(import.meta.url)) {
  runGuard(({ flags }) =>
    report('deps-boundary', checkBoundaries(process.cwd()), { quiet: flags.quiet }),
  );
}
