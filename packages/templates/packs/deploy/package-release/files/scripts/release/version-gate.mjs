#!/usr/bin/env node
// Refuses to release a version the registry already has (published versions are immutable) and,
// with --tag, checks that the git tag matches package.json. Exit 2 names the problem.
//   node scripts/release/version-gate.mjs [--tag v1.2.3]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain, parseArgs } from '../guard/lib/common.mjs';
import { run, which } from '../guard/lib/proc.mjs';

export function checkTag(version, tag) {
  return tag === undefined || tag === `v${version}` ? [] : [`tag ${tag} does not match package.json version ${version}`];
}

/** `npm view <name>@<version> version` prints the version when it exists and fails with E404 when not. */
export function publishedFinding(name, version, view) {
  if (view.code === 0 && view.stdout.trim() === version) return [`${name}@${version} is already published; bump the version`];
  if (view.code !== 0 && !/E404|404 Not Found/.test(view.stderr)) throw new Error(`npm view failed:\n${view.stderr}`);
  return [];
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const bin = which('npm');
  (async () => {
    if (!bin) throw new Error('npm is not on PATH');
    const view = await run(bin[0], [...bin[1], 'view', `${pkg.name}@${pkg.version}`, 'version'], { capture: true });
    return [...checkTag(pkg.version, flags.tag), ...publishedFinding(pkg.name, pkg.version, view)];
  })().then(
    (findings) => {
      for (const f of findings) process.stderr.write(`✖ ${f}\n`);
      if (!findings.length) process.stdout.write(`✔ ${pkg.name}@${pkg.version} is new\n`);
      process.exitCode = findings.length ? EXIT.POLICY : EXIT.OK;
    },
    (err) => {
      process.stderr.write(`version-gate: ${err.message}\n`);
      process.exitCode = EXIT.TOOL;
    },
  );
}
