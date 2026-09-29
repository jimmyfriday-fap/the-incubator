/** Dotted-path helpers used for decisions (`stack.pack`) and draft diffs. */

export function getAt(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function setAt<T extends Record<string, unknown>>(obj: T, path: string, value: unknown): T {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (const part of parts.slice(0, -1)) {
    const next = cur[part];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
  return obj;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Leaf paths whose values differ between `a` and `b` (arrays compare as whole values). */
export function changedPaths(a: unknown, b: unknown, prefix = ''): string[] {
  if (isPlain(a) && isPlain(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => changedPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k));
  }
  if (isPlain(b) && a === undefined) return changedPaths({}, b, prefix);
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [prefix];
}

/** Deep merge of plain objects; arrays and scalars from `over` replace those in `base`. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isPlain(base) || !isPlain(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over))
    out[k] = v === undefined ? out[k] : deepMerge(out[k], v);
  return out as T;
}

/** True when `path` equals `key` or lies under it (`stack` covers `stack.pack`). */
export function covers(key: string, path: string): boolean {
  return path === key || path.startsWith(`${key}.`);
}
