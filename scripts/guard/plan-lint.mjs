#!/usr/bin/env node
// Executor plans live in docs/plans/NNN-slug.md and carry the five required sections.
import { isMain, listFiles, readText, report, runGuard } from './lib/common.mjs';

export const REQUIRED_SECTIONS = [
  { heading: 'Executor preamble' },
  { heading: 'Touched files and markers', table: true },
  { heading: 'Acceptance commands', fences: 2 },
  { heading: 'Drift and hallucination guardrails', table: ['Trap', 'Why', 'Mechanical check'] },
  { heading: 'Review rounds', table: true, status: /\b(FIX-FIRST|CLOSED)\b/ },
];

function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

export function lintPlan(file, text) {
  const findings = [];
  for (const req of REQUIRED_SECTIONS) {
    const body = section(text, req.heading);
    if (body === null) {
      findings.push(`${file}: missing "## ${req.heading}"`);
      continue;
    }
    const tableLines = body.split('\n').filter((l) => l.trim().startsWith('|'));
    if (req.table && tableLines.length < 3)
      findings.push(`${file}: "${req.heading}" needs a table with at least one row`);
    if (Array.isArray(req.table)) {
      const header = (tableLines[0] ?? '').split('|').map((c) => c.trim());
      for (const col of req.table)
        if (!header.includes(col))
          findings.push(`${file}: "${req.heading}" table lacks column "${col}"`);
    }
    if (req.fences && (body.match(/^```/gm) ?? []).length < req.fences * 2) {
      findings.push(`${file}: "${req.heading}" needs a command block and an expected-output block`);
    }
    if (
      req.status &&
      tableLines.length >= 3 &&
      !tableLines.slice(2).every((l) => req.status.test(l))
    ) {
      findings.push(`${file}: every "${req.heading}" row needs a FIX-FIRST or CLOSED status`);
    }
  }
  return findings;
}

export function lintPlans(root, files) {
  const findings = [];
  for (const f of files) {
    if (/^[^/]*plan[^/]*\.md$/i.test(f))
      findings.push(`${f}: plans belong in docs/plans/, not the repo root`);
    if (!f.startsWith('docs/plans/') || !f.endsWith('.md') || f.endsWith('/README.md')) continue;
    if (!/^docs\/plans\/\d{3}-[a-z0-9-]+\.md$/.test(f))
      findings.push(`${f}: plan files are named NNN-kebab-slug.md`);
    findings.push(...lintPlan(f, readText(root, f) ?? ''));
  }
  return findings;
}

if (isMain(import.meta.url)) {
  runGuard(({ flags }) => {
    const root = process.cwd();
    return report('plan-lint', lintPlans(root, listFiles(root)), { quiet: flags.quiet });
  });
}
