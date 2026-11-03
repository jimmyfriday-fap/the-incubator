import { describe, expect, it } from 'vitest';
import { planReverseOut, type ReverseFacts } from './reverse-out.js';
import type { RunState } from './state.js';

const state = (over: Partial<RunState> = {}): RunState =>
  ({
    runId: '20260101-000000-abcd',
    input: { kind: 'enhance', dir: '/work/app' },
    state: 'PARKED',
    steps: {
      'folder.base': { status: 'ok', data: { branch: 'main', head: 'abc' } },
      deliver: { status: 'ok', data: { branch: 'incubator/enhance-20260101', from: 'main' } },
    },
    done: false,
    cancelled: false,
    ...over,
  }) as unknown as RunState;

const facts = (over: Partial<ReverseFacts> = {}): ReverseFacts => ({
  state: state(),
  working: false,
  runFolder: 'data/runs/r1',
  dir: '/work/app',
  currentBranch: 'main',
  dirtyCount: 0,
  backshack: null,
  ...over,
});

describe('planning a reverse-out (plan 069)', () => {
  it('deletes the run branch and the run folder, and nothing else', () => {
    const p = planReverseOut(facts());
    expect(p.allowed).toBe(true);
    expect(p.actions).toEqual([
      {
        kind: 'delete-branch',
        dir: '/work/app',
        branch: 'incubator/enhance-20260101',
        returnTo: null,
      },
      { kind: 'remove-run-folder', dir: 'data/runs/r1' },
    ]);
  });

  it('goes back to the branch the owner started on when the run branch is checked out', () => {
    const p = planReverseOut(facts({ currentBranch: 'incubator/enhance-20260101' }));
    expect(p.actions[0]).toMatchObject({ kind: 'delete-branch', returnTo: 'main' });
  });

  it('refuses to touch uncommitted work on the run branch', () => {
    const p = planReverseOut(facts({ currentBranch: 'incubator/enhance-20260101', dirtyCount: 3 }));
    expect(p).toMatchObject({ allowed: false, refusal: { code: 'dirty_tree' }, actions: [] });
  });

  it('leaves a checked-out branch alone when no earlier branch was recorded, and says so', () => {
    const s = state();
    delete s.steps['folder.base'];
    const p = planReverseOut(facts({ state: s, currentBranch: 'incubator/enhance-20260101' }));
    expect(p.actions.map((a) => a.kind)).toEqual(['remove-run-folder']);
    expect(p.leftBehind[0]?.what).toMatch(/checked out/);
  });

  it('refuses a working run and a run that finished normally; allows a cancelled one', () => {
    expect(planReverseOut(facts({ working: true })).refusal?.code).toBe('working');
    expect(planReverseOut(facts({ state: state({ done: true }) })).refusal?.code).toBe('finished');
    expect(planReverseOut(facts({ state: state({ done: true, cancelled: true }) })).allowed).toBe(
      true,
    );
  });

  it('never deletes a branch the Incubator did not name', () => {
    const s = state();
    s.steps['deliver'] = { status: 'ok', data: { branch: 'main', from: 'main' } };
    const p = planReverseOut(facts({ state: s }));
    expect(p.actions.map((a) => a.kind)).toEqual(['remove-run-folder']);
  });

  it('removes a Backshack worktree, with a confirmation when it holds uncommitted files, then its branch', () => {
    const s = state({ input: { kind: 'enhance', dir: '/wt/backshack-x' } as never });
    s.steps['deliver'] = { status: 'ok', data: { branch: 'incubator/backshack-x', from: 'x' } };
    const p = planReverseOut(
      facts({
        state: s,
        dir: '/wt/backshack-x',
        dirtyCount: 2,
        backshack: { repo: '/dev', dir: '/wt/backshack-x' },
      }),
    );
    expect(p.needsConfirm).toBe(true);
    expect(p.actions.map((a) => a.kind)).toEqual([
      'remove-worktree',
      'delete-branch',
      'remove-run-folder',
    ]);
    expect(p.actions[1]).toMatchObject({ dir: '/dev', branch: 'incubator/backshack-x' });
  });

  it('names a repository the run created on GitHub instead of deleting it', () => {
    const s = state();
    s.steps['repo.create'] = { status: 'ok', data: { url: 'https://github.com/o/r' } };
    const p = planReverseOut(facts({ state: s }));
    expect(p.leftBehind).toEqual([
      { what: 'a GitHub repository this run created', url: 'https://github.com/o/r' },
    ]);
    expect(p.actions.some((a) => JSON.stringify(a).includes('github'))).toBe(false);
  });
});
