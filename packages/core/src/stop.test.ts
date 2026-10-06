import { describe, expect, it } from 'vitest';
import { InterruptedError } from '@incubator/runtime';
import { FakeLlmAdapter, type LlmAdapter } from '@incubator/llm';
import { DefaultsPrompter } from './prompter.js';
import { reduce } from './state.js';
import { discoveryFixtureDir, fakePublishEngine } from './testing.js';

const entry = (type: string, fields: Record<string, unknown> = {}, seq = 1) => ({
  type,
  seq,
  ts: '2026-05-01T12:00:00.000Z',
  ...fields,
});

describe('the journal says when a run was stopped or cancelled', () => {
  const base = [
    entry('run.start', { runId: 'r', input: { kind: 'new', surface: 'test' } }),
    entry('state.enter', { state: 'DRAFT_SPEC', round: 1 }),
  ];
  it('keeps a stop until the run moves again, in whichever way it moves', () => {
    const stopped = reduce([...base, entry('interrupted', { by: 'owner', state: 'DRAFT_SPEC' })]);
    expect(stopped.stopped).toEqual({ by: 'owner', state: 'DRAFT_SPEC' });
    expect(stopped.done).toBe(false);
    // An older entry that has no `by` is a signal.
    expect(reduce([...base, entry('interrupted')]).stopped).toEqual({
      by: 'signal',
      state: 'DRAFT_SPEC',
    });
    for (const next of [
      entry('state.enter', { state: 'CLARIFY' }),
      entry('park', { reason: 'needs_input', message: 'm' }),
      entry('resume', { to: 'DRAFT_SPEC' }),
      entry('failed', { state: 'DRAFT_SPEC', message: 'boom' }),
      entry('run.done'),
    ])
      expect(
        reduce([...base, entry('interrupted', { by: 'owner' }), next]).stopped,
        next.type,
      ).toBeNull();
  });

  it('ends a cancelled run: done, not resumable, nothing waiting on the owner', () => {
    const s = reduce([
      ...base,
      entry('park', { reason: 'needs_input', message: 'm' }),
      entry('run.cancel', { reason: 'not needed' }),
    ]);
    expect(s).toMatchObject({
      cancelled: true,
      done: true,
      parked: null,
      failure: null,
      stopped: null,
    });
    expect(reduce(base).cancelled).toBe(false);
  });
});

describe('stopping and cancelling a run', () => {
  /** A model that hangs until it is stopped, then (when released) answers from recorded turns. */
  function slowModel() {
    const recorded = new FakeLlmAdapter({ dir: discoveryFixtureDir('saas-web') });
    const state = { hang: true, invoked: 0 };
    const adapter: LlmAdapter = {
      id: 'fake',
      probe: () => recorded.probe(),
      invoke: (req) => {
        if (!state.hang) return recorded.invoke(req);
        state.invoked++;
        return new Promise((_resolve, reject) => {
          req.signal?.addEventListener('abort', () => reject(new Error('the call was cancelled')));
        });
      },
    };
    return { adapter, state };
  }
  const waitFor = async (ok: () => boolean) => {
    for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(ok()).toBe(true);
  };

  it('stops a model call at once, says who stopped it, and the run resumes where it was', async () => {
    const { adapter, state } = slowModel();
    const h = fakePublishEngine({ llm: adapter });
    const runId = h.engine.start({
      kind: 'new',
      narrative: 'Stockroom: stock tracking for cafés.',
      specOnly: true,
      yes: true,
      surface: 'test',
    });
    const working = h.engine.advance(runId, new DefaultsPrompter());
    await waitFor(() => state.invoked === 1);
    expect(h.engine.activeRuns()).toEqual([runId]);
    // Cancel is refused while the run is working: stop it first.
    expect(() => h.engine.cancel(runId)).toThrow(/working: stop it first/);

    expect(h.engine.abortRun(runId, 'owner')).toBe(true);
    await expect(working).rejects.toBeInstanceOf(InterruptedError);
    const s = h.engine.state(runId);
    expect(s.stopped).toEqual({ by: 'owner', state: 'DRAFT_SPEC' });
    expect(s.failure).toBeNull();
    expect(s.done).toBe(false);
    expect(h.engine.activeRuns()).toEqual([]);
    expect(h.engine.abortRun(runId)).toBe(false); // nothing is running now
    expect(h.engine.entries(runId).findLast((e) => e.type === 'interrupted')).toMatchObject({
      by: 'owner',
      state: 'DRAFT_SPEC',
    });
    expect(h.engine.entries(runId).some((e) => e.type === 'failed')).toBe(false);

    // Resumed, it carries on from the same step and the stop is forgotten.
    state.hang = false;
    const resumed = await h.engine.resume(runId, new DefaultsPrompter());
    expect(resumed.stopped).toBeNull();
    expect(resumed.done).toBe(true);
  });

  it('cancels a run for good: it cannot be resumed or advanced, and the journal says so', async () => {
    const { adapter, state } = slowModel();
    const h = fakePublishEngine({ llm: adapter, portfolio: true });
    const runId = h.engine.start({
      kind: 'new',
      narrative: 'Stockroom: stock tracking for cafés.',
      surface: 'test',
    });
    const working = h.engine.advance(runId, new DefaultsPrompter());
    await waitFor(() => state.invoked === 1);
    h.engine.abortRun(runId, 'owner');
    await working.catch(() => undefined);

    h.engine.cancel(runId, 'changed my mind\u0000 <b>');
    const s = h.engine.state(runId);
    expect(s).toMatchObject({ cancelled: true, done: true, stopped: null });
    const cancel = h.engine.entries(runId).findLast((e) => e.type === 'run.cancel')!;
    expect(cancel['reason']).toBe('changed my mind  <b>');
    const count = h.engine.entries(runId).length;
    expect((await h.engine.resume(runId, new DefaultsPrompter())).cancelled).toBe(true);
    expect((await h.engine.advance(runId, new DefaultsPrompter())).cancelled).toBe(true);
    expect(h.engine.entries(runId)).toHaveLength(count);
    expect(state.invoked).toBe(1);
    expect(() => h.engine.cancel(runId)).toThrow(
      expect.objectContaining({ code: 'not_cancellable' }),
    );
    // The portfolio shows it as cancelled, so it stops looking in progress.
    expect(h.engine.portfolioForRun(runId)?.runs[0]).toMatchObject({
      state: 'CANCELLED',
      done: true,
    });
  });

  it('stops every working run on shutdown, and says it was the app', async () => {
    const { adapter, state } = slowModel();
    const h = fakePublishEngine({ llm: adapter });
    const runId = h.engine.start({
      kind: 'new',
      narrative: 'Stockroom: stock tracking for cafés.',
      surface: 'test',
    });
    const working = h.engine.advance(runId, new DefaultsPrompter());
    await waitFor(() => state.invoked === 1);
    expect(h.engine.abortAll('shutdown')).toEqual([runId]);
    await expect(working).rejects.toBeInstanceOf(InterruptedError);
    expect(h.engine.state(runId).stopped?.by).toBe('shutdown');
    expect(h.engine.abortAll('shutdown')).toEqual([]);
  });

  it('refuses to work on one run twice at the same time', async () => {
    const { adapter, state } = slowModel();
    const h = fakePublishEngine({ llm: adapter });
    const runId = h.engine.start({
      kind: 'new',
      narrative: 'Stockroom: stock tracking for cafés.',
      surface: 'test',
    });
    const working = h.engine.advance(runId, new DefaultsPrompter());
    await waitFor(() => state.invoked === 1);
    await expect(h.engine.advance(runId, new DefaultsPrompter())).rejects.toMatchObject({
      code: 'working',
    });
    h.engine.abortRun(runId);
    await working.catch(() => undefined);
  });
});
