#!/usr/bin/env node
// Isolation lint: no import/require/include resolving outside the repo, no escaping symlinks,
// no agent-instruction links pointing outside the repo, no sys.path hacks reaching out.
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { isMain, listFiles, readText, report, runGuard } from './lib/common.mjs';

const JS_EXT = /\.(?:[cm]?[jt]sx?)$/;
const JS_SPECIFIERS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const PHP_INCLUDE = /\b(?:require|include)(?:_once)?\s*\(?\s*(__DIR__\s*\.\s*)?['"]([^'"]+)['"]/g;
const PY_SYSPATH = /sys\.path\.(?:append|insert)\s*\(([^)]*)\)/g;
const MD_LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
export const AGENT_FILES = [
  /^CLAUDE\.md$/,
  /^AGENTS\.md$/,
  /^\.github\/copilot-instructions\.md$/,
  /^\.cursor\/rules\/.+\.mdc$/,
];

function escapes(root, fromFile, target) {
  const resolved = path.resolve(root, path.dirname(fromFile), target);
  const rel = path.relative(root, resolved);
  return rel.startsWith('..') || path.isAbsolute(rel);
}

export function findIsolationIssues(root, files) {
  const findings = [];
  const realRoot = realpathSync(root);
  for (const f of files) {
    const abs = path.join(root, f);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      let real;
      try {
        real = realpathSync(abs);
      } catch {
        findings.push(`${f}: dangling symlink`);
        continue;
      }
      const rel = path.relative(realRoot, real);
      if (rel.startsWith('..') || path.isAbsolute(rel))
        findings.push(`${f}: symlink escapes the repo`);
      continue;
    }
    const text = readText(root, f);
    if (text === null) continue;
    if (JS_EXT.test(f)) {
      for (const re of JS_SPECIFIERS) {
        for (const m of text.matchAll(re)) {
          const spec = m[1];
          if (spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('file:')) {
            findings.push(`${f}: absolute import "${spec}"`);
          } else if (spec.startsWith('.') && escapes(root, f, spec)) {
            findings.push(`${f}: import "${spec}" resolves outside the repo`);
          }
        }
      }
    } else if (f.endsWith('.php')) {
      for (const m of text.matchAll(PHP_INCLUDE)) {
        const target = m[1] ? `.${m[2].startsWith('/') ? '' : '/'}${m[2]}` : m[2];
        if (!m[1] && path.isAbsolute(target)) findings.push(`${f}: absolute include "${target}"`);
        else if (escapes(root, f, target))
          findings.push(`${f}: include "${m[2]}" resolves outside the repo`);
      }
    } else if (f.endsWith('.py')) {
      for (const m of text.matchAll(PY_SYSPATH)) {
        if (/['"]\/|\.\.|['"][A-Za-z]:/.test(m[1]))
          findings.push(`${f}: sys.path mutation reaches outside: ${m[0]}`);
      }
    }
    if (AGENT_FILES.some((re) => re.test(f))) {
      for (const m of text.matchAll(MD_LINK)) {
        const target = m[1].split('#')[0];
        if (!target || /^(https?:|mailto:)/.test(target)) continue;
        if (
          target.startsWith('file:') ||
          path.isAbsolute(target) ||
          /^[A-Za-z]:[\\/]/.test(target)
        ) {
          findings.push(`${f}: link to absolute location "${m[1]}"`);
        } else if (escapes(root, f, target)) {
          findings.push(`${f}: link "${m[1]}" points outside the repo`);
        }
      }
    }
  }
  return findings;
}

if (isMain(import.meta.url)) {
  runGuard(({ flags }) => {
    const root = process.cwd();
    return report('isolation', findIsolationIssues(root, listFiles(root)), { quiet: flags.quiet });
  });
}
