import { describe, expect, it } from 'vitest';
import { PolicyError } from '@incubator/runtime';
import {
  INTAKE_RUN_CEILINGS,
  SPEC_BLOCK_MAX_BYTES,
  createIntakeSource,
  intakeConfig,
  intakeHost,
  parseIntakeTicket,
} from './intake.js';

const draft = {
  project: { name: 'Pump Rounds' },
  platform: 'web',
  intent: {
    narrative: 'A tablet app for water-plant operators to log pump rounds and flag faults.',
    personas: ['Plant operator', 'Shift supervisor'],
    coreFeatures: [
      { id: 'log-rounds', summary: 'Log a round per pump with readings', lane: 'enhancement/new' },
      { id: 'flag-faults', summary: 'Flag a fault with a photo', lane: 'enhancement/new' },
    ],
  },
};

const body = (block: string): string => `## Request summary
Custom app request #17 from Dana Whitfield (Eastgate Water).
- WordPress status: new

## Who
Dana Whitfield, operations lead at Eastgate Water, a 12-person utility.

## Problem today
Pump rounds are written on paper and typed in later; faults get lost.

## Wanted outcome
Operators log rounds on a tablet and supervisors see faults the same day.

## Spec draft
${block}

## Open questions
- Does it need to work offline?

## Contact
dana@example.com, 555-0100

## Progress this ticket
Claim it, commit with LT#, set Ready for Test.
`;

const fenced = (j: unknown): string =>
  '```incubator-spec-draft\n' + JSON.stringify(j, null, 2) + '\n```';

const ticket = (description: string, projectId = 9) => ({
  id: 4321,
  projectId,
  headline: 'Custom app: Eastgate Water pump rounds',
  description,
});

describe('parseIntakeTicket', () => {
  it('reads a realistic ticket into a valid spec, the request and no gaps', () => {
    const r = parseIntakeTicket(ticket(body(fenced(draft))), { projectId: 9 });
    expect(r.gaps).toEqual([]);
    expect(r.draft.project.name).toBe('Pump Rounds');
    expect(r.draft.project.slug).toBe('pump-rounds');
    expect(r.draft.intent.coreFeatures.map((f) => f.id)).toEqual(['log-rounds', 'flag-faults']);
    expect(r.request).toMatchObject({
      leantimeTicketId: 4321,
      headline: 'Custom app: Eastgate Water pump rounds',
      who: expect.stringContaining('Eastgate Water') as unknown,
      problem: expect.stringContaining('paper') as unknown,
      outcome: expect.stringContaining('tablet') as unknown,
      wpStatus: 'new',
      contact: 'dana@example.com, 555-0100',
      openQuestions: '- Does it need to work offline?',
    });
  });

  it('forces the runbook ceilings whatever the ticket asks for', () => {
    const greedy = {
      ...draft,
      agents: { runCeilings: { turns: 9999, toolCalls: 9999, minutes: 999, usd: 999 } },
    };
    const r = parseIntakeTicket(ticket(body(fenced(greedy))), { projectId: 9 });
    expect(r.draft.agents.runCeilings).toEqual(INTAKE_RUN_CEILINGS);
    expect(INTAKE_RUN_CEILINGS).toEqual({ turns: 150, toolCalls: 400, minutes: 45, usd: 10 });
  });

  it('rejects a ticket from another project', () => {
    expect(() => parseIntakeTicket(ticket(body(fenced(draft)), 3), { projectId: 9 })).toThrow(
      expect.objectContaining({ code: 'intake_wrong_project' }) as Error,
    );
  });

  it('reports gaps for a missing block, a missing name and missing features', () => {
    const none = parseIntakeTicket(ticket(body('(not drafted yet)')), { projectId: 9 });
    expect(none.gaps.join('\n')).toContain('no incubator-spec-draft block');
    expect(none.draft.project.name).toBe('Custom app: Eastgate Water pump rounds');
    expect(none.draft.intent.narrative).toContain('Pump rounds are written on paper');
    expect(none.gaps.join('\n')).toContain('lists no features');

    const thin = parseIntakeTicket(ticket(body(fenced({ platform: 'web' }))), { projectId: 9 });
    expect(thin.gaps.join('\n')).toContain('no narrative');
  });

  it('keeps invalid spec content out and says why', () => {
    const r = parseIntakeTicket(ticket(body(fenced({ platform: 'toaster' }))), { projectId: 9 });
    expect(r.gaps.join('\n')).toContain('is not valid, so it was left out');
    expect(r.draft.platform).not.toBe('toaster');
  });

  it('reports sections that are missing', () => {
    const r = parseIntakeTicket(ticket(`## Who\nSomeone\n\n${fenced(draft)}\n`), { projectId: 9 });
    expect(r.gaps).toContain('The ticket has no "Contact" section.');
    expect(r.gaps).toContain('The ticket has no "Problem today" section.');
  });

  it('rejects malformed, non-object and oversized blocks', () => {
    const bad = (block: string): unknown =>
      (() => {
        try {
          parseIntakeTicket(ticket(body(block)), { projectId: 9 });
        } catch (e) {
          return e;
        }
        return null;
      })();
    const broken = bad('```incubator-spec-draft\n{ "project": \n```');
    expect(broken).toBeInstanceOf(PolicyError);
    expect(broken).toMatchObject({ code: 'intake_bad_block' });
    expect(bad('```incubator-spec-draft\n[1,2]\n```')).toMatchObject({ code: 'intake_bad_block' });
    const big = fenced({ intent: { narrative: 'x'.repeat(SPEC_BLOCK_MAX_BYTES) } });
    expect(bad(big)).toMatchObject({ code: 'intake_block_too_large' });
  });

  it('reads a ticket Leantime returned as rich text', () => {
    const html = body(fenced(draft))
      .split('\n')
      .map((l) => (l.startsWith('## ') ? `<h2>${l.slice(3)}</h2>` : `<p>${l}</p>`))
      .join('')
      .replace(/"/g, '&quot;');
    const r = parseIntakeTicket(ticket(html), { projectId: 9 });
    expect(r.draft.project.name).toBe('Pump Rounds');
    expect(r.request.contact).toContain('dana@example.com');
  });
});

describe('intake configuration', () => {
  it('accepts https and localhost http, and refuses the rest', () => {
    const cfg = (baseUrl: string, projectId = 9) => ({
      intake: { leantime: { baseUrl, projectId } },
    });
    expect(intakeConfig(cfg('https://pm.example.com')).projectId).toBe(9);
    expect(intakeConfig(cfg('http://localhost:8002')).baseUrl).toBe('http://localhost:8002');
    for (const bad of [
      cfg('http://pm.example.com'),
      cfg('https://user:pw@pm.example.com'),
      cfg('nope'),
      cfg('https://pm.example.com', 0),
      {},
    ])
      expect(() => intakeConfig(bad)).toThrow(PolicyError);
    expect(intakeHost(cfg('https://PM.example.com/'))).toBe('pm.example.com');
    expect(intakeHost(cfg('http://localhost:8002'))).toBeNull();
    expect(intakeHost({})).toBeNull();
  });

  it('fetches a ticket through the tracker with the keychain token', async () => {
    const seen: { key: string | null; method: string; id: number }[] = [];
    const src = createIntakeSource({
      config: () => ({ intake: { leantime: { baseUrl: 'https://pm.example.com', projectId: 9 } } }),
      keychain: {
        available: () => Promise.resolve(true),
        get: () => Promise.resolve('keychain-token'),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      } as never,
      env: {},
      fetchImpl: (_u: unknown, init?: RequestInit) => {
        const b = JSON.parse(init?.body as string) as { method: string; params: { id: number } };
        seen.push({
          key: new Headers(init?.headers).get('x-api-key'),
          method: b.method,
          id: b.params.id,
        });
        return Promise.resolve(
          Response.json({
            jsonrpc: '2.0',
            id: 1,
            result: {
              id: 4321,
              projectId: 9,
              headline: 'H',
              description: body(fenced(draft)),
            },
          }),
        );
      },
    });
    expect(src.configured()).toBe(true);
    const r = await src.fetch(4321);
    expect(r.draft.project.name).toBe('Pump Rounds');
    expect(seen).toEqual([
      { key: 'keychain-token', method: 'leantime.rpc.Tickets.Tickets.getTicket', id: 4321 },
    ]);
  });

  it('says so when nothing is configured or the key is missing', async () => {
    const keychain = { available: () => Promise.resolve(false) } as never;
    const none = createIntakeSource({ config: () => ({}), keychain, env: {} });
    expect(none.configured()).toBe(false);
    await expect(none.fetch(1)).rejects.toMatchObject({ code: 'intake_unconfigured' });
    const nokey = createIntakeSource({
      config: () => ({ intake: { leantime: { baseUrl: 'https://pm.example.com', projectId: 9 } } }),
      keychain,
      env: {},
    });
    await expect(nokey.fetch(1)).rejects.toMatchObject({ code: 'no_leantime_key' });
  });
});
