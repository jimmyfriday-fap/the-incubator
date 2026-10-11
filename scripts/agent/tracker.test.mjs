// Unit tests for the generated repository's tracker client (plan 047).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { advanceToReady, pathTo, transition } from './tracker.mjs';

function repo(state) {
  const root = mkdtempSync(path.join(tmpdir(), 'tracker '));
  mkdirSync(path.join(root, '.incubator', 'tickets'), { recursive: true });
  writeFileSync(
    path.join(root, '.incubator', 'tracker.json'),
    `${JSON.stringify({ type: 'local', ticketsDir: '.incubator/tickets' })}\n`,
  );
  writeFileSync(
    path.join(root, '.incubator', 'tickets', 'F-a.json'),
    `${JSON.stringify({ id: 'F-a', state, remediations: ['kept'] }, null, 2)}\n`,
  );
  return root;
}

const ticketOf = (root) =>
  JSON.parse(readFileSync(path.join(root, '.incubator', 'tickets', 'F-a.json'), 'utf8'));

describe('the Stop hook marks a ticket ready from where the Incubator left it (plan 047)', () => {
  it('finds the legal way forward to READY_FOR_TEST, or none', () => {
    expect(pathTo('TAGGED_TO_RELEASE', 'READY_FOR_TEST')).toEqual([
      'ENRICHMENT_IN_PROGRESS',
      'DEV_IN_PROGRESS',
      'READY_FOR_TEST',
    ]);
    expect(pathTo('TEST_FAILED', 'READY_FOR_TEST')).toEqual(['DEV_IN_PROGRESS', 'READY_FOR_TEST']);
    expect(pathTo('READY_FOR_TEST', 'READY_FOR_TEST')).toEqual([]);
    expect(pathTo('PARKED', 'READY_FOR_TEST')).toBeNull();
    expect(pathTo('TEST_PASSED', 'READY_FOR_TEST')).toBeNull();
    expect(pathTo('DEPLOYED', 'READY_FOR_TEST')).toBeNull();
    // The retry cycle (READY_FOR_TEST → TEST_FAILED → DEV_IN_PROGRESS) never loops when the target is unreachable.
    expect(pathTo('DEV_IN_PROGRESS', 'NEW')).toBeNull();
  });

  it('moves a tagged ticket to READY_FOR_TEST, which a single transition refuses', async () => {
    const root = repo('TAGGED_TO_RELEASE');
    await expect(transition(root, 'F-a', 'READY_FOR_TEST')).rejects.toThrow(
      'illegal ticket transition TAGGED_TO_RELEASE → READY_FOR_TEST',
    );
    expect(ticketOf(root).state).toBe('TAGGED_TO_RELEASE');
    expect(await advanceToReady(root, 'F-a')).toBe('READY_FOR_TEST');
    expect(ticketOf(root)).toEqual({ id: 'F-a', state: 'READY_FOR_TEST', remediations: ['kept'] });
    // Already ready: nothing changes.
    expect(await advanceToReady(root, 'F-a')).toBe('READY_FOR_TEST');
    expect(ticketOf(root).state).toBe('READY_FOR_TEST');
  });

  it('never revives a parked or finished ticket', async () => {
    for (const state of ['PARKED', 'TEST_PASSED', 'DEPLOYED']) {
      const root = repo(state);
      await expect(advanceToReady(root, 'F-a')).rejects.toThrow(
        `illegal ticket transition ${state} → READY_FOR_TEST`,
      );
      expect(ticketOf(root).state).toBe(state);
    }
  });
});
