import { describe, expect, it } from 'vitest';
import type { IntakeTicketView } from '../api-types.js';
import { beginBlocker, editsFrom, featureIdFor, startBody } from './requests.js';

const ticket: IntakeTicketView = {
  draft: {
    project: { name: 'Pump Rounds', slug: 'pump-rounds' },
    intent: {
      narrative: 'Log pump rounds.',
      personas: ['Operator'],
      coreFeatures: [{ id: 'log-rounds', summary: 'Log a round', lane: 'enhancement/new' }],
    },
  },
  gaps: [],
  request: {
    leantimeTicketId: 4321,
    headline: 'H',
    who: 'w',
    problem: 'p',
    outcome: 'o',
    contact: 'c',
  },
};

describe('Custom App request form', () => {
  it('keeps Begin development off until the deposit is ticked and the edits are usable', () => {
    const edits = editsFrom(ticket);
    expect(beginBlocker({ depositReceived: false, edits, busy: false })).toContain('deposit');
    expect(beginBlocker({ depositReceived: true, edits, busy: false })).toBeNull();
    expect(beginBlocker({ depositReceived: true, edits, busy: true })).toBe('Starting…');
    expect(
      beginBlocker({ depositReceived: true, edits: { ...edits, narrative: '  ' }, busy: false }),
    ).toContain('narrative');
    expect(
      beginBlocker({
        depositReceived: true,
        edits: { ...edits, features: [{ id: 'x', summary: ' ', lane: 'enhancement/new' }] },
        busy: false,
      }),
    ).toContain('summary');
  });

  it('posts the edited spec with the ticket number and the deposit confirmation', () => {
    const edits = editsFrom(ticket);
    edits.narrative = '  Edited.  ';
    edits.features.push({ id: 'flag-faults', summary: 'Flag a fault', lane: 'enhancement/new' });
    const body = startBody(ticket, edits);
    expect(body).toMatchObject({
      kind: 'new',
      intake: { leantimeTicketId: 4321, depositReceived: true },
    });
    const intent = (body.spec as { intent: { narrative: string; coreFeatures: unknown[] } }).intent;
    expect(intent.narrative).toBe('Edited.');
    expect(intent.coreFeatures).toHaveLength(2);
    expect((body.spec as { project: unknown }).project).toEqual(ticket.draft.project);
  });

  it('makes valid, unique feature ids', () => {
    expect(featureIdFor('Flag a fault!', [])).toBe('flag-a-fault');
    expect(featureIdFor('Flag a fault!', ['flag-a-fault'])).toBe('flag-a-fault-2');
    expect(featureIdFor('123 go', [])).toBe('go');
    expect(featureIdFor('!!!', [])).toBe('feature');
    expect(featureIdFor('x'.repeat(80), [])).toMatch(/^[a-z][a-z0-9-]{0,48}$/);
  });
});
