import type { SpecChange } from '../api-types.js';

const escape = (k: string) => k.replace(/~/g, '~0').replace(/\//g, '~1');
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function leaves(v: unknown, at: string, out: Map<string, unknown>): void {
  if (isObject(v) && Object.keys(v).length > 0)
    for (const k of Object.keys(v)) leaves(v[k], `${at}/${escape(k)}`, out);
  // why: an empty root is "no spec yet", not a value that was removed.
  else if (at !== '' || !isObject(v)) out.set(at, v);
}

/**
 * A JSON-pointer diff between two spec revisions. Objects are walked key by key; arrays and scalars
 * are compared as whole values, which keeps decision and feature lists readable in the UI.
 */
export function specDiff(before: unknown, after: unknown): SpecChange[] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  leaves(before ?? {}, '', a);
  leaves(after ?? {}, '', b);
  const out: SpecChange[] = [];
  for (const [p, v] of a) {
    if (!b.has(p)) out.push({ pointer: p, op: 'remove', before: v });
    else if (JSON.stringify(v) !== JSON.stringify(b.get(p)))
      out.push({ pointer: p, op: 'replace', before: v, after: b.get(p) });
  }
  for (const [p, v] of b) if (!a.has(p)) out.push({ pointer: p, op: 'add', after: v });
  return out.sort((x, y) => (x.pointer < y.pointer ? -1 : x.pointer > y.pointer ? 1 : 0));
}
