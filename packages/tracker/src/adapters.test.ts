import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PolicyError, SecretString, ToolError } from '@incubator/runtime';
import { FakeTracker, LeantimeTracker, LocalTracker } from './adapters.js';

const ticket = {
  id: 'F-inventory',
  title: 'Track stock',
  lane: 'enhancement/new',
  description: 'd',
};

describe('LocalTracker', () => {
  it('creates tickets once and enforces the ticket state machine', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'tickets-'));
    const t = new LocalTracker(root);
    expect(await t.ensureTicket(ticket)).toEqual({ ref: 'F-inventory', created: true });
    expect(await t.ensureTicket(ticket)).toEqual({ ref: 'F-inventory', created: false });
    await t.transition('F-inventory', 'ENRICHMENT_IN_PROGRESS');
    await t.transition('F-inventory', 'ENRICHMENT_IN_PROGRESS');
    expect(t.read('F-inventory')?.state).toBe('ENRICHMENT_IN_PROGRESS');
    await expect(t.transition('F-inventory', 'DEPLOYED')).rejects.toThrow(PolicyError);
    await expect(t.transition('F-nope', 'DEPLOYED')).rejects.toThrow('no ticket');
    await expect(t.ensureTicket({ ...ticket, id: '../escape' })).rejects.toThrow(
      'invalid ticket id',
    );
  });
});

describe('FakeTracker', () => {
  it('records calls and injects failures', async () => {
    const t = new FakeTracker();
    t.failNext = 'ensureTicket';
    await expect(t.ensureTicket(ticket)).rejects.toThrow(ToolError);
    expect((await t.ensureTicket(ticket)).created).toBe(true);
    await t.transition('F-inventory', 'ENRICHMENT_IN_PROGRESS');
    expect(t.calls).toEqual([
      'ensureTicket F-inventory',
      'ensureTicket F-inventory',
      'transition F-inventory ENRICHMENT_IN_PROGRESS',
    ]);
  });
});

describe('LeantimeTracker', () => {
  function server(
    tickets: { id: number; tags: string }[],
    opts: { status?: number; error?: boolean } = {},
  ) {
    const seen: { method: string; params: Record<string, unknown>; key: string | null }[] = [];
    const fetchImpl = (_url: URL | string | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as {
        method: string;
        params: Record<string, unknown>;
        id: number;
      };
      seen.push({
        method: body.method,
        params: body.params,
        key: new Headers(init?.headers).get('x-api-key'),
      });
      if (opts.status) return Promise.resolve(new Response('{}', { status: opts.status }));
      if (opts.error)
        return Promise.resolve(
          Response.json({
            jsonrpc: '2.0',
            id: body.id,
            error: { code: -32601, message: 'Method not found' },
          }),
        );
      const result = body.method.endsWith('getAll')
        ? tickets
        : body.method.endsWith('addTicket')
          ? [42]
          : true;
      return Promise.resolve(Response.json({ jsonrpc: '2.0', id: body.id, result }));
    };
    return { seen, fetch: fetchImpl };
  }
  const make = (s: ReturnType<typeof server>) =>
    new LeantimeTracker({
      baseUrl: 'https://pm.example.com',
      projectId: 7,
      apiKey: new SecretString('test-secret-leantime-key'),
      statusMap: { TAGGED_TO_RELEASE: 3, ENRICHMENT_IN_PROGRESS: 4 },
      fetch: s.fetch,
    });

  it('finds tickets by their incubator tag before creating them', async () => {
    const s = server([{ id: 9, tags: 'lane:x, incubator:F-inventory' }]);
    expect(await make(s).ensureTicket(ticket)).toEqual({ ref: '9', created: false });
    const empty = server([]);
    expect(await make(empty).ensureTicket(ticket)).toEqual({ ref: '42', created: true });
    expect(empty.seen[1]).toMatchObject({
      method: 'leantime.rpc.Tickets.Tickets.addTicket',
      params: {
        values: { projectId: 7, tags: 'incubator:F-inventory,lane:enhancement/new', status: 3 },
      },
      key: 'test-secret-leantime-key',
    });
  });

  it('maps states through statusMap and errors onto the exit-code contract', async () => {
    const s = server([]);
    await make(s).transition('42', 'ENRICHMENT_IN_PROGRESS');
    expect(s.seen[0]).toMatchObject({
      method: 'leantime.rpc.Tickets.Tickets.patch',
      params: { id: 42, params: { status: 4 } },
    });
    await expect(make(s).transition('42', 'DEPLOYED')).rejects.toThrow('no status for DEPLOYED');
    await expect(make(server([], { status: 401 })).ensureTicket(ticket)).rejects.toThrow(
      PolicyError,
    );
    await expect(make(server([], { status: 500 })).ensureTicket(ticket)).rejects.toThrow(ToolError);
    await expect(make(server([], { error: true })).ensureTicket(ticket)).rejects.toThrow(
      'Method not found',
    );
    expect(
      () =>
        new LeantimeTracker({
          baseUrl: 'http://pm.example.com',
          projectId: 1,
          apiKey: new SecretString('k'),
        }),
    ).toThrow('https');
  });
});
