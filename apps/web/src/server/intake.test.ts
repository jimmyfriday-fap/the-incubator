import { afterEach, describe, expect, it } from 'vitest';
import { PolicyError } from '@incubator/runtime';
import { parseIntakeTicket, type IntakeSource } from '@incubator/core';
import type { IntakeTicketView, RunDetail } from '../api-types.js';
import { apiClient, startFakeServer } from '../testing-fixtures/fake-web.js';
import type { RunningServer } from './server.js';

const open: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
});

const draft = {
  project: { name: 'Pump Rounds' },
  platform: 'web',
  intent: {
    narrative: 'A tablet app for water-plant operators to log pump rounds.',
    personas: ['Plant operator'],
    coreFeatures: [{ id: 'log-rounds', summary: 'Log a round per pump', lane: 'enhancement/new' }],
  },
};

const description = `## Request summary
Custom app request.

## Who
Dana, operations lead.

## Problem today
Paper rounds.

## Wanted outcome
Tablet logging.

## Spec draft
\`\`\`incubator-spec-draft
${JSON.stringify(draft)}
\`\`\`

## Contact
dana@example.com
`;

/** A Leantime stand-in that knows one ticket (id 4321, project 9). */
function source(): IntakeSource & { fetched: number[] } {
  const fetched: number[] = [];
  return {
    fetched,
    configured: () => true,
    host: () => 'pm.example.com',
    fetch: (id) => {
      fetched.push(id);
      if (id === 404)
        return Promise.reject(new PolicyError('no ticket', { code: 'intake_not_found' }));
      return Promise.resolve(
        parseIntakeTicket(
          { id, projectId: id === 7 ? 3 : 9, headline: 'Custom app: Eastgate', description },
          { projectId: 9 },
        ),
      );
    },
  };
}

async function boot(intake?: IntakeSource) {
  const r = await startFakeServer(intake ? { intake } : {});
  open.push(r.server);
  return { ...r, api: await apiClient(r.server) };
}

describe('Custom App requests', () => {
  it('says so when requests are not set up', async () => {
    const { api } = await boot();
    const r = await api.get<{ error: string }>('/api/intake/tickets/12');
    expect(r.status).toBe(404);
    expect(r.body.error).toContain('intake.leantime');
    const run = await api.post('/api/runs', {
      kind: 'new',
      spec: {},
      intake: { leantimeTicketId: 12, depositReceived: true },
    });
    expect(run.status).toBe(404);
  });

  it('reads a ticket by number, and only a number', async () => {
    const intake = source();
    const { api } = await boot(intake);
    const r = await api.get<IntakeTicketView>('/api/intake/tickets/4321');
    expect(r.status).toBe(200);
    expect(r.body.draft.project.name).toBe('Pump Rounds');
    expect(r.body.request).toMatchObject({ leantimeTicketId: 4321, who: 'Dana, operations lead.' });
    expect(r.body.gaps).toEqual([]);
    expect((await api.get('/api/intake/tickets/abc')).status).toBe(400);
    expect((await api.get('/api/intake/tickets/1%2F..')).status).toBe(400);
    expect((await api.get('/api/intake/tickets/404')).status).toBe(404);
    expect((await api.get('/api/intake/tickets/7')).status).toBe(422);
    expect(intake.fetched).toEqual([4321, 404, 7]);
  });

  it('refuses a ticket from another project', async () => {
    const intake: IntakeSource = {
      configured: () => true,
      host: () => null,
      fetch: () =>
        Promise.reject(new PolicyError('wrong project', { code: 'intake_wrong_project' })),
    };
    const { api } = await boot(intake);
    expect((await api.get('/api/intake/tickets/9')).status).toBe(422);
  });

  it('starts a run from the edited spec with the ticket recorded and the ceilings forced', async () => {
    const { api, server, h } = await boot(source());
    const ticket = (await api.get<IntakeTicketView>('/api/intake/tickets/4321')).body;
    const edited = {
      ...ticket.draft,
      intent: {
        ...ticket.draft.intent,
        narrative: 'Edited by the owner.',
        coreFeatures: [
          ...ticket.draft.intent.coreFeatures,
          { id: 'flag-faults', summary: 'Flag a fault', lane: 'enhancement/new' },
        ],
      },
      // The client cannot loosen the run: these must be ignored.
      agents: { runCeilings: { turns: 9999, toolCalls: 9999, minutes: 999, usd: 999 } },
      project: { name: 'Hijacked', slug: 'hijacked' },
    };
    const started = await api.post<{ runId: string }>('/api/runs', {
      kind: 'new',
      spec: edited,
      intake: { leantimeTicketId: 4321, depositReceived: true },
    });
    expect(started.status).toBe(202);
    const runId = started.body.runId;
    await server.driver.idle(runId);
    const d = (await api.get<RunDetail>(`/api/runs/${runId}`)).body;
    expect(d.kind).toBe('new');
    const spec = h.engine.approvedSpec(runId);
    expect(spec.intent.narrative).toBe('Edited by the owner.');
    expect(spec.intent.coreFeatures.map((f) => f.id)).toEqual(['log-rounds', 'flag-faults']);
    expect(spec.project.name).toBe('Pump Rounds');
    expect(spec.agents.runCeilings).toEqual({ turns: 150, toolCalls: 400, minutes: 45, usd: 10 });
    expect(h.engine.state(runId).input.intake).toEqual({
      leantimeTicketId: 4321,
      depositReceived: true,
      ceilings: { turns: 150, toolCalls: 400, minutes: 45, usd: 10 },
    });
  });

  it('does not start without the deposit confirmation, a ticket number or kind "new"', async () => {
    const { api } = await boot(source());
    const base = { kind: 'new', spec: {} };
    expect(
      (
        await api.post('/api/runs', {
          ...base,
          intake: { leantimeTicketId: 1, depositReceived: false },
        })
      ).status,
    ).toBe(400);
    expect((await api.post('/api/runs', { ...base })).status).toBe(400);
    expect(
      (
        await api.post('/api/runs', {
          kind: 'new',
          intake: { leantimeTicketId: 1, depositReceived: true },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api.post('/api/runs', {
          kind: 'adopt',
          repo: 'x/y',
          spec: {},
          intake: { leantimeTicketId: 1, depositReceived: true },
        })
      ).status,
    ).toBe(400);
  });

  it('rejects an edit that makes the spec invalid before any run is made', async () => {
    const { api } = await boot(source());
    const bad = await api.post<{ error: string }>('/api/runs', {
      kind: 'new',
      spec: { intent: { coreFeatures: [{ id: 'Bad Id', summary: 'x', lane: 'nope' }] } },
      intake: { leantimeTicketId: 4321, depositReceived: true },
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toContain('invalid');
    expect((await api.get<unknown[]>('/api/runs')).body).toEqual([]);
  });
});
