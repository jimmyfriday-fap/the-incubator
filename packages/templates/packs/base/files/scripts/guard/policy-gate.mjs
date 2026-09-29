#!/usr/bin/env node
// Policy gate: exits 2 on any finding at or above the threshold that the accepted-risk register
// does not cover. Inline suppressions without a register entry are findings themselves.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain, listFiles, readJson, readText, runGuard } from './lib/common.mjs';
import {
  gitleaksFindings,
  rank,
  SEVERITIES,
  semgrepFindings,
  trivyFindings,
} from './lib/findings.mjs';

const INLINE = /(?:#|\/\/|\/\*|<!--)\s*(nosemgrep|gitleaks:allow)(?::\s*([\w.-]+))?/;

export function validateRegister(register, today) {
  const problems = [];
  const active = new Map();
  (register.entries ?? []).forEach((e, i) => {
    const missing = ['fingerprint', 'ruleId', 'reason', 'owner', 'expires'].filter(
      (k) => typeof e[k] !== 'string' || !e[k],
    );
    if (missing.length) problems.push(`accepted-risks entry ${i}: missing ${missing.join(', ')}`);
    else if (e.expires < today)
      problems.push(
        `accepted-risks entry ${i} (${e.ruleId}) expired ${e.expires}; finding is active again`,
      );
    else active.set(e.fingerprint, e);
  });
  return { problems, active };
}

export function inlineSuppressions(root, files) {
  const out = [];
  for (const f of files) {
    if (f.startsWith('scripts/guard/')) continue;
    const text = readText(root, f);
    if (text === null) continue;
    text.split('\n').forEach((line, i) => {
      const m = INLINE.exec(line);
      if (m)
        out.push({
          path: f,
          line: i + 1,
          ruleId: m[2] ?? m[1],
          fingerprint: `inline:${f}:${m[2] ?? m[1]}`,
        });
    });
  }
  return out;
}

export function gate({ findings, suppressions, register, threshold, today }) {
  const { problems, active } = validateRegister(register, today);
  const blocking = [];
  const accepted = [];
  for (const f of findings) {
    if (rank(f.severity) < rank(threshold)) continue;
    if (active.has(f.fingerprint)) accepted.push(f);
    else blocking.push(f);
  }
  for (const s of suppressions) {
    if (!active.has(s.fingerprint)) {
      blocking.push({
        tool: 'policy',
        ruleId: 'incubator.unregistered-suppression',
        path: s.path,
        line: s.line,
        severity: 'HIGH',
        message: `inline suppression of ${s.ruleId} has no accepted-risks entry`,
        fingerprint: s.fingerprint,
      });
    }
  }
  return { blocking, accepted, problems };
}

if (isMain(import.meta.url)) {
  runGuard(({ flags }) => {
    const root = process.cwd();
    const dir = path.join(root, String(flags.dir ?? 'scan-results'));
    const load = (n) =>
      existsSync(path.join(dir, `${n}.json`))
        ? JSON.parse(readFileSync(path.join(dir, `${n}.json`), 'utf8'))
        : null;
    const findings = [
      ...(load('semgrep') ? semgrepFindings(root, load('semgrep')) : []),
      ...(load('trivy') ? trivyFindings(load('trivy')) : []),
      ...(load('gitleaks') ? gitleaksFindings(load('gitleaks')) : []),
    ];
    const spec = readJson(root, 'incubator.json', null);
    const threshold = String(flags.threshold ?? spec?.security?.policyGate ?? 'HIGH').toUpperCase();
    if (!SEVERITIES.includes(threshold)) throw new Error(`unknown threshold ${threshold}`);
    const register = readJson(root, 'security/accepted-risks.json', { entries: [] });
    const today = new Date().toISOString().slice(0, 10);
    const result = gate({
      findings,
      suppressions: inlineSuppressions(root, listFiles(root)),
      register,
      threshold,
      today,
    });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'policy-report.json'),
      `${JSON.stringify({ threshold, ...result }, null, 2)}\n`,
    );
    for (const p of result.problems) process.stdout.write(`! ${p}\n`);
    for (const f of result.blocking)
      process.stdout.write(
        `✖ [${f.severity}] ${f.tool}/${f.ruleId} ${f.path}:${f.line} ${f.message} (fp ${f.fingerprint.slice(0, 16)})\n`,
      );
    process.stdout.write(
      `policy-gate: ${findings.length} finding(s), ${result.accepted.length} accepted, ${result.blocking.length} blocking at ≥ ${threshold}\n`,
    );
    return result.blocking.length || result.problems.some((p) => p.includes('missing'))
      ? EXIT.POLICY
      : EXIT.OK;
  });
}
