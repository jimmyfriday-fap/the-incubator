#!/usr/bin/env node
// Workflow hygiene: SHA-pinned `uses:` with a version comment, top-level least-privilege permissions,
// a `# why:` comment on every conditional or multi-line step, triage steps that cannot change the
// verdict; then actionlint (fetched hash-pinned into .tools/).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain, listFiles, readText, report, runGuard } from './lib/common.mjs';
import { run } from './lib/proc.mjs';

const indentOf = (l) => l.length - l.trimStart().length;

function itemStart(lines, i) {
  const ind = indentOf(lines[i]);
  if (/^\s*- /.test(lines[i])) return i;
  for (let j = i - 1; j >= 0; j--) {
    const l = lines[j];
    if (!l.trim() || l.trim().startsWith('#')) continue;
    const li = indentOf(l);
    if (li < ind) {
      if (/^\s*- /.test(l)) return j;
      if (/^\s*[\w-]+:\s*$/.test(l)) return j;
      return j;
    }
  }
  return i;
}

function hasWhyAbove(lines, start) {
  for (let j = start - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (t.startsWith('# why:')) return true;
    if (t.startsWith('#')) continue;
    return false;
  }
  return false;
}

export function lintWorkflow(file, text) {
  const findings = [];
  const lines = text.split('\n');
  if (!lines.some((l) => /^permissions:/.test(l)))
    findings.push(`${file}: missing top-level permissions:`);
  lines.forEach((line, i) => {
    const uses = /^\s*(?:- )?uses:\s*([^\s#]+)(\s*#\s*(\S+))?/.exec(line);
    if (uses) {
      const ref = uses[1];
      if (!ref.startsWith('./') && !ref.startsWith('docker://')) {
        if (!/@[0-9a-f]{40}$/.test(ref))
          findings.push(`${file}:${i + 1}: uses ${ref} is not pinned to a full commit SHA`);
        else if (!uses[3])
          findings.push(`${file}:${i + 1}: pinned uses needs a "# vX.Y.Z" comment`);
      } else if (ref.startsWith('docker://') && !/@sha256:[0-9a-f]{64}$/.test(ref)) {
        findings.push(`${file}:${i + 1}: docker image ${ref} is not digest-pinned`);
      }
    }
    const isIf = /^\s*(?:- )?if:/.test(line);
    const isMultiRun = /^\s*(?:- )?run:\s*[|>]/.test(line);
    if (isIf || isMultiRun) {
      const start = itemStart(lines, i);
      if (!hasWhyAbove(lines, i) && !hasWhyAbove(lines, start)) {
        findings.push(
          `${file}:${i + 1}: ${isIf ? 'conditional' : 'multi-line run'} step needs a "# why:" comment above it`,
        );
      }
    }
    if (/^\s*(?:- )?name:.*\btriage\b/i.test(line)) {
      const start = itemStart(lines, i);
      const ind = indentOf(lines[start]);
      const body = [lines[start]];
      for (
        let j = start + 1;
        j < lines.length && (indentOf(lines[j]) > ind || !lines[j].trim());
        j++
      )
        body.push(lines[j]);
      const joined = body.join('\n');
      if (
        !/continue-on-error:\s*true/.test(joined) ||
        !/if:\s*\$?\{?\{?\s*failure\(\)/.test(joined)
      ) {
        findings.push(
          `${file}:${i + 1}: triage steps must use if: failure() and continue-on-error: true`,
        );
      }
    }
  });
  return findings;
}

export function actionlintPath(root) {
  const exe = process.platform === 'win32' ? 'actionlint.exe' : 'actionlint';
  const p = path.join(root, '.tools', 'actionlint', exe);
  return existsSync(p) ? p : null;
}

if (isMain(import.meta.url)) {
  runGuard(async ({ flags }) => {
    const root = process.cwd();
    const files = listFiles(root).filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
    const findings = files.flatMap((f) => lintWorkflow(f, readText(root, f) ?? ''));
    const code = report('workflow-lint', findings, { quiet: flags.quiet });
    const bin = actionlintPath(root);
    if (!bin) {
      if (flags['require-actionlint']) {
        process.stderr.write(
          'actionlint not found in .tools/ (run: node scripts/tools-fetch.mjs)\n',
        );
        return EXIT.TOOL;
      }
      return code;
    }
    if (files.length === 0) return code;
    const res = await run(bin, ['-no-color', '-oneline', ...files], { cwd: root, capture: true });
    if (res.code === 0) {
      process.stdout.write('✔ actionlint: ok\n');
      return code;
    }
    process.stdout.write(`✖ actionlint:\n${res.stdout}${res.stderr}`);
    return res.code === 1 ? EXIT.POLICY : EXIT.TOOL;
  });
}
