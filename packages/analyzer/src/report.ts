import type { Analysis } from './detectors.js';
import { summarizeGaps, type GapItem } from './canonical.js';

export interface Delta {
  create: string[];
  proposed: string[];
  identical: string[];
  /** Differing files the repository's own lockfile already owns (left alone). */
  owned: string[];
}

const ICON = { present: '✅', partial: '🟡', missing: '❌' } as const;

/** The gap report as Markdown (the adopt PR body). Deterministic for a given input. */
export function renderGapReport(a: Analysis, items: readonly GapItem[], delta?: Delta): string {
  const s = summarizeGaps(items);
  const lines = [
    '# Incubator gap report',
    '',
    `**Stack:** ${a.stack ? `${a.stack.pack} (${a.stack.framework}, ${a.stack.platform}; ${a.stack.confidence} confidence)` : a.ecosystem ? `${a.ecosystem.label} (no stack pack)` : 'not detected'}  `,
    `**Tests:** ${a.tests.count} test(s) in ${a.tests.files} file(s)${a.tests.runners.length ? ` — ${a.tests.runners.join(', ')}` : ''}  `,
    `**Canonical items:** ${s.present} present, ${s.partial} partial, ${s.missing} missing${a.truncated ? ' (repository truncated at 5,000 files)' : ''}`,
    '',
    '| Status | Item | Section | Detail |',
    '| --- | --- | --- | --- |',
    ...items.map(
      (i) =>
        `| ${ICON[i.status]} ${i.status} | \`${i.id}\` ${i.title} | ${i.section} | ${i.detail.map((d) => `\`${d.replace(/\|/g, '\\|')}\``).join(', ')} |`,
    ),
  ];
  if (delta) {
    lines.push(
      '',
      '## Changes in this pull request',
      '',
      `Nothing existing is modified: ${delta.create.length} file(s) are added, ${delta.proposed.length} conflicting file(s) are proposed next to the originals as \`<file>.incubator-proposed\`, ${delta.identical.length} already match.`,
    );
    if (delta.proposed.length)
      lines.push(
        '',
        '### Proposed (review and merge by hand)',
        '',
        ...delta.proposed.map((p) => `- \`${p}\` → \`${p}.incubator-proposed\``),
      );
    if (delta.create.length)
      lines.push(
        '',
        '<details><summary>Added files</summary>',
        '',
        ...delta.create.map((p) => `- \`${p}\``),
        '',
        '</details>',
      );
  }
  return `${lines.join('\n')}\n`;
}
