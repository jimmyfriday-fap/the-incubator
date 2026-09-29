// Enrich output contract (lane templates and runtime enrich results share this parser).
export const VERDICTS = ['REAL_FIX', 'NOT_A_BUG', 'DUPLICATE', 'NEEDS_INFO', 'OUT_OF_SCOPE'];

/** Returns { ok, verdict, steps, errors }. */
export function parseEnrichOutput(text) {
  const errors = [];
  const verdictLines = [...text.matchAll(/^VERDICT:\s*(\S+)\s*$/gm)];
  if (verdictLines.length !== 1)
    errors.push(`expected exactly one VERDICT line, found ${verdictLines.length}`);
  const verdict = verdictLines[0]?.[1] ?? null;
  if (verdict !== null && !VERDICTS.includes(verdict)) errors.push(`unknown verdict ${verdict}`);
  const stepRe = /^\*\*Step (\d+):\*\*/gm;
  const heads = [...text.matchAll(stepRe)];
  const steps = heads.map((m, i) => {
    const start = m.index;
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    const body = text.slice(start, end);
    return {
      n: Number(m[1]),
      targets: [...body.matchAll(/^- Target:\s*(\S.*)$/gm)].map((t) => t[1].trim()),
    };
  });
  if (verdict === 'REAL_FIX') {
    if (steps.length === 0) errors.push('REAL_FIX needs at least one **Step N:** block');
    steps.forEach((s, i) => {
      if (s.n !== i + 1)
        errors.push(`steps must be numbered 1..N (found Step ${s.n} at position ${i + 1})`);
      if (s.targets.length === 0) errors.push(`Step ${s.n} has no "- Target:" line`);
    });
  }
  return { ok: errors.length === 0, verdict, steps, errors };
}
