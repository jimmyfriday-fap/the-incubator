import { readFileSync } from 'node:fs';

// why: schemas ship next to src/ and dist/ (one level up from both), so a URL relative to this
// module resolves in tests, in the built package and inside Electron's asar alike.
function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;
}

export const specSchema = load('incubator.schema.json');
export const discoveryTurnSchema = load('discovery-turn.schema.json');

function stripRequired(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripRequired);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'required' || k === 'minItems') continue;
    out[k] = stripRequired(v);
  }
  return out;
}

/** The spec schema with every `required` removed: the shape of a draft during discovery. */
export const partialSpecSchema = {
  ...(stripRequired(specSchema) as Record<string, unknown>),
  $id: 'https://incubator.local/schemas/incubator.partial.schema.json',
  title: 'IncubatorSpecDraft',
};

/** DiscoveryTurn with draftSpec constrained to the partial spec (sent to LLMs as the output schema). */
export const discoveryTurnWireSchema = (() => {
  const s = structuredClone(discoveryTurnSchema) as {
    properties: Record<string, unknown>;
    $defs?: unknown;
  };
  const partial = structuredClone(partialSpecSchema) as Record<string, unknown>;
  const defs = partial['$defs'];
  delete partial['$defs'];
  delete partial['$schema'];
  delete partial['$id'];
  s.properties['draftSpec'] = { ...partial, description: 'A partial incubator.json.' };
  return {
    ...s,
    $defs: defs,
    $id: 'https://incubator.local/schemas/discovery-turn.wire.schema.json',
  };
})();
