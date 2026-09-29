/**
 * RFC 8785 JSON Canonicalization Scheme: sorted keys (UTF-16 code-unit order), no whitespace,
 * ECMAScript number serialization. Used for spec hashes.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('JCS: non-finite number');
      return Object.is(value, -0) ? '0' : String(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v ?? null)).join(',')}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
    }
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      throw new TypeError(`JCS: unsupported type ${typeof value}`);
  }
  throw new TypeError('JCS: unreachable');
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortDeep(obj[key]);
    return out;
  }
  return value;
}

/** Pretty JSON with 2-space indent and one trailing LF. `sortKeys` sorts recursively. */
export function stableJson(value: unknown, opts: { sortKeys?: boolean } = {}): string {
  const v = opts.sortKeys ? sortDeep(value) : value;
  return `${JSON.stringify(v, null, 2)}\n`;
}
