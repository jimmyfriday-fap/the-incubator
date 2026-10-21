import type { IntakeTicketView, StartRunBody } from '../api-types.js';

/** The part of a Custom App request the owner may change before the build starts. */
export interface RequestEdits {
  narrative: string;
  features: { id: string; summary: string; lane: string }[];
}

export const editsFrom = (t: IntakeTicketView): RequestEdits => ({
  narrative: t.draft.intent.narrative,
  features: t.draft.intent.coreFeatures.map((f) => ({ ...f })),
});

/** A feature id is lower-case kebab: a letter first, then letters, digits and dashes (spec rule). */
export function featureIdFor(summary: string, taken: readonly string[]): string {
  const base =
    summary
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'feature';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** Why Begin development is not available yet, or null when it is. */
export function beginBlocker(s: {
  depositReceived: boolean;
  edits: RequestEdits;
  busy: boolean;
}): string | null {
  if (s.busy) return 'Starting…';
  if (!s.depositReceived) return 'Tick "50% deposit received" first.';
  if (!s.edits.narrative.trim()) return 'The narrative cannot be empty.';
  if (s.edits.features.some((f) => !f.summary.trim())) return 'Every feature needs a summary.';
  return null;
}

/** The body for `POST /api/runs`: the edited spec and the ticket number; the server re-reads the ticket. */
export function startBody(t: IntakeTicketView, edits: RequestEdits): StartRunBody {
  return {
    kind: 'new',
    spec: {
      ...t.draft,
      intent: {
        ...t.draft.intent,
        narrative: edits.narrative.trim(),
        coreFeatures: edits.features.map((f) => ({ ...f, summary: f.summary.trim() })),
      },
    },
    intake: { leantimeTicketId: t.request.leantimeTicketId, depositReceived: true },
  };
}
