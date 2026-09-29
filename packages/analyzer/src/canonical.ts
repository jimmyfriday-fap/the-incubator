import { readFileSync } from 'node:fs';
import type { IncubatorSpec } from '@incubator/spec';
import type { RepoView } from './repo-view.js';

export type CanonicalStatus = 'present' | 'partial' | 'missing';

export interface CanonicalItem {
  id: string;
  section: string;
  title: string;
  all?: string[];
  any?: string[];
  contains?: string;
  when?: IncubatorSpec['stack']['pack'][];
}

export interface GapItem {
  id: string;
  section: string;
  title: string;
  status: CanonicalStatus;
  /** Files that matched (at most 5), or the globs that did not. */
  detail: string[];
}

export function loadCanonical(): CanonicalItem[] {
  const doc = JSON.parse(readFileSync(new URL('../canonical.json', import.meta.url), 'utf8')) as {
    items: CanonicalItem[];
  };
  return doc.items;
}

/** present / partial / missing for one item (TDD §7.3 canonical checks). */
export function checkItem(view: RepoView, item: CanonicalItem): GapItem {
  const base = { id: item.id, section: item.section, title: item.title };
  const probe = item.contains ? new RegExp(item.contains, 'i') : null;
  if (item.all) {
    const hits = item.all.map((g) => view.glob(g));
    const matched = hits.filter((h) => h.length > 0).length;
    if (matched === 0) return { ...base, status: 'missing', detail: item.all };
    const files = hits.flat();
    const probed = !probe || files.some((f) => probe.test(view.read(f) ?? ''));
    return matched === item.all.length && probed
      ? { ...base, status: 'present', detail: files.slice(0, 5) }
      : { ...base, status: 'partial', detail: item.all.filter((_, i) => hits[i]!.length === 0) };
  }
  const files = (item.any ?? []).flatMap((g) => view.glob(g));
  if (!files.length) return { ...base, status: 'missing', detail: item.any ?? [] };
  if (probe && !files.some((f) => probe.test(view.read(f) ?? '')))
    return {
      ...base,
      status: 'partial',
      detail: [`${files[0]} does not match /${item.contains}/`],
    };
  return { ...base, status: 'present', detail: files.slice(0, 5) };
}

export function gapReport(
  view: RepoView,
  pack: IncubatorSpec['stack']['pack'] | null,
  items = loadCanonical(),
): GapItem[] {
  return items
    .filter((i) => !i.when || (pack !== null && i.when.includes(pack)))
    .map((i) => checkItem(view, i));
}

/** Counts per status; a repo is compliant when nothing is partial or missing. */
export function summarizeGaps(
  items: readonly { status: CanonicalStatus }[],
): Record<CanonicalStatus, number> & { compliant: boolean } {
  const counts = { present: 0, partial: 0, missing: 0 };
  for (const item of items) counts[item.status]++;
  return { ...counts, compliant: counts.partial === 0 && counts.missing === 0 };
}
