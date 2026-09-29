import { ToolError, canonicalize } from '@incubator/runtime';

export interface JsonPatchOp {
  op: 'set' | 'merge' | 'append-unique' | 'remove';
  pointer: string;
  value?: unknown;
}

function segments(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return [];
  if (!pointer.startsWith('/')) throw new ToolError(`JSON pointer must start with "/": ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mergeDeep(a: unknown, b: unknown): unknown {
  if (!isPlain(a) || !isPlain(b)) return structuredClone(b);
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b))
    out[k] = k in out ? mergeDeep(out[k], v) : structuredClone(v);
  return out;
}

/** Declarative JSON patches (ADR-005): deterministic, idempotent for set/merge/append-unique. */
export function applyJsonPatch(file: string, doc: unknown, ops: readonly JsonPatchOp[]): unknown {
  let root = structuredClone(doc);
  for (const op of ops) {
    const segs = segments(op.pointer);
    if (segs.length === 0) {
      if (op.op === 'merge') root = mergeDeep(root, op.value);
      else if (op.op === 'set') root = structuredClone(op.value);
      else throw new ToolError(`${file}: ${op.op} needs a non-root pointer`);
      continue;
    }
    let parent: Record<string, unknown> | unknown[] = root as Record<string, unknown>;
    for (const seg of segs.slice(0, -1)) {
      const next: unknown = Array.isArray(parent) ? parent[Number(seg)] : parent[seg];
      if (next === undefined && op.op !== 'remove' && !Array.isArray(parent)) {
        parent[seg] = {};
      } else if (next === null || typeof next !== 'object') {
        throw new ToolError(`${file}: pointer ${op.pointer} crosses a non-object`);
      }
      parent = (Array.isArray(parent) ? parent[Number(seg)] : parent[seg]) as
        Record<string, unknown> | unknown[];
    }
    const key = segs[segs.length - 1]!;
    if (Array.isArray(parent))
      throw new ToolError(`${file}: pointer ${op.pointer} must end at an object key`);
    switch (op.op) {
      case 'set':
        parent[key] = structuredClone(op.value);
        break;
      case 'merge':
        parent[key] =
          parent[key] === undefined ? structuredClone(op.value) : mergeDeep(parent[key], op.value);
        break;
      case 'append-unique': {
        const arr = parent[key] === undefined ? [] : parent[key];
        if (!Array.isArray(arr)) throw new ToolError(`${file}: ${op.pointer} is not an array`);
        const add = Array.isArray(op.value) ? op.value : [op.value];
        const seen = new Set(arr.map((x) => canonicalize(x)));
        for (const v of add) if (!seen.has(canonicalize(v))) arr.push(structuredClone(v));
        parent[key] = arr;
        break;
      }
      case 'remove':
        delete parent[key];
        break;
      default:
        throw new ToolError(`${file}: unknown JSON patch op`);
    }
  }
  return root;
}
