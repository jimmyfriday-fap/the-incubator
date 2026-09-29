#!/usr/bin/env node
// Release smoke: packs the package with npm, installs the tarball into an empty scratch project,
// imports it, runs every declared bin with --version, and writes SHA256SUMS next to the tarball.
//   node scripts/release/package-smoke.mjs --out release-assets
// Exit 0 pass, 1 a tool broke (npm missing, pack failed), 2 the package does not work as released.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXIT, isMain, parseArgs } from '../guard/lib/common.mjs';
import { run, which } from '../guard/lib/proc.mjs';

/** `bin` as a name → relative path map (npm accepts a string for single-bin packages). */
export function binEntries(pkg) {
  if (!pkg.bin) return {};
  if (typeof pkg.bin === 'string') return { [pkg.name.replace(/^@[^/]+\//, '')]: pkg.bin };
  return pkg.bin;
}

export function sha256sums(files) {
  return files
    .map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${path.basename(f)}\n`)
    .join('');
}

async function npm(args, cwd) {
  const bin = which('npm');
  if (!bin) throw new Error('npm is not on PATH');
  return run(bin[0], [...bin[1], ...args], { cwd, capture: true });
}

export async function smokePackage(root, outDir) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  mkdirSync(outDir, { recursive: true });
  const packed = await npm(['pack', '--json', '--pack-destination', outDir], root);
  if (packed.code !== 0) throw new Error(`npm pack failed:\n${packed.stderr}`);
  const [{ filename }] = JSON.parse(packed.stdout);
  const tarball = path.join(outDir, path.basename(filename));
  const findings = [];
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'package-smoke-'));
  try {
    writeFileSync(
      path.join(scratch, 'package.json'),
      `${JSON.stringify({ name: 'package-smoke', private: true, type: 'module' })}\n`,
    );
    const installed = await npm(
      ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball],
      scratch,
    );
    if (installed.code !== 0) findings.push(`installing the tarball failed:\n${installed.stderr}`);
    else {
      const imported = await run(
        process.execPath,
        ['--input-type=module', '-e', `await import(${JSON.stringify(pkg.name)});`],
        { cwd: scratch, capture: true },
      );
      if (imported.code !== 0) findings.push(`importing ${pkg.name} failed:\n${imported.stderr}`);
      for (const [name, rel] of Object.entries(binEntries(pkg))) {
        const r = await run(
          process.execPath,
          [path.join(scratch, 'node_modules', pkg.name, rel), '--version'],
          { cwd: scratch, capture: true },
        );
        if (r.code !== 0) findings.push(`bin ${name} --version exited ${r.code}:\n${r.stderr}`);
        else if (r.stdout.trim() !== pkg.version)
          findings.push(`bin ${name} --version printed "${r.stdout.trim()}", expected ${pkg.version}`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  writeFileSync(path.join(outDir, 'SHA256SUMS'), sha256sums([tarball]));
  return { tarball, findings };
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  smokePackage(process.cwd(), path.resolve(flags.out ?? 'release-assets')).then(
    ({ tarball, findings }) => {
      for (const f of findings) process.stderr.write(`✖ ${f}\n`);
      if (!findings.length) process.stdout.write(`✔ package smoke: ${path.basename(tarball)}\n`);
      process.exitCode = findings.length ? EXIT.POLICY : EXIT.OK;
    },
    (err) => {
      process.stderr.write(`package-smoke: ${err.message}\n`);
      process.exitCode = EXIT.TOOL;
    },
  );
}
