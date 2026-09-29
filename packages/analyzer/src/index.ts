export type CanonicalStatus = 'present' | 'partial' | 'missing';

export interface GapItem {
  id: string;
  status: CanonicalStatus;
}

/** Counts per status; a repo is compliant when nothing is partial or missing. */
export function summarizeGaps(
  items: readonly GapItem[],
): Record<CanonicalStatus, number> & { compliant: boolean } {
  const counts = { present: 0, partial: 0, missing: 0 };
  for (const item of items) counts[item.status]++;
  return { ...counts, compliant: counts.partial === 0 && counts.missing === 0 };
}
