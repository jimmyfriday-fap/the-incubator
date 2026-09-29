import { jsonHash } from '@incubator/runtime';
import { specSchema } from './schemas.js';
import type { IncubatorSpec } from './types.gen.js';

type Node = Record<string, unknown>;

function resolve(node: Node | undefined): Node | undefined {
  const ref = node?.['$ref'];
  if (typeof ref === 'string' && ref.startsWith('#/$defs/')) {
    return (specSchema['$defs'] as Record<string, Node>)[ref.slice('#/$defs/'.length)];
  }
  return node;
}

function order(value: unknown, schema: Node | undefined): unknown {
  const s = resolve(schema);
  if (Array.isArray(value)) return value.map((v) => order(v, s?.['items'] as Node | undefined));
  if (value === null || typeof value !== 'object') return value;
  const props = (s?.['properties'] ?? {}) as Record<string, Node>;
  const obj = value as Record<string, unknown>;
  const known = Object.keys(props).filter((k) => k in obj);
  const extra = Object.keys(obj)
    .filter((k) => !(k in props))
    .sort();
  const out: Record<string, unknown> = {};
  for (const k of [...known, ...extra]) if (obj[k] !== undefined) out[k] = order(obj[k], props[k]);
  return out;
}

/** incubator.json bytes: schema key order, 2-space indent, trailing LF. Deterministic. */
export function serializeSpec(spec: IncubatorSpec | Record<string, unknown>): string {
  return `${JSON.stringify(order(spec, specSchema), null, 2)}\n`;
}

/** RFC 8785 hash of the spec: `sha256:<hex>`. */
export function specHash(spec: IncubatorSpec): string {
  return jsonHash(spec);
}
