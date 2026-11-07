import { PolicyError } from '@incubator/runtime';
import { BACKSHACK_STACK } from '@incubator/spec';
import type { RunInput } from './store.js';

/**
 * Memory by default for a new build (docs/incubator-memory-feature.md, plan 074). Before any code is
 * generated the run decides where the new solution's memory lives, and why. The decision is journaled as
 * `memory.plan` and copied onto the project (`PortfolioProject.memoryPlan`).
 */

/** What the owner chose on the new-build form: the Memory toggle (default on) and, optionally, a system. */
export interface BuildMemoryChoice {
  enabled: boolean;
  /** The system whose store the new repository joins (Add member). Only a system the portfolio knows. */
  system?: string;
}

/**
 * `repo`: a `.memory/` store in the new repository. `member`: the new repository joins an existing
 * system's store. `none`: the owner turned memory off. `target`: the code goes into an existing
 * repository, so no new store is made.
 */
export type MemoryPlanMode = 'repo' | 'member' | 'none' | 'target';

export interface MemoryPlan {
  mode: MemoryPlanMode;
  /** Shown to the owner on the run page and in the build report. */
  reason: string;
  /** `member` only. */
  system?: string;
}

/** The plan a new build with a folder gets; null for runs that have no coding session or are not new builds. */
export function resolveMemoryDestination(
  input: Pick<RunInput, 'kind' | 'dir' | 'buildMemory' | 'stack'>,
  knownSystems: readonly string[],
): MemoryPlan | null {
  // Row 3 (ADR-032): code that goes into an existing repository, or a Backshack tool, makes no new store.
  if (input.kind === 'enhance' && (input.dir || input.stack === BACKSHACK_STACK))
    return input.stack === BACKSHACK_STACK
      ? {
          mode: 'target',
          reason:
            'the code goes into a Backshack tool, whose memory belongs to the Backshack repository; no new store is made',
        }
      : {
          mode: 'target',
          reason:
            'the code goes into an existing repository, so its memory stays where that repository keeps it; no new store is made',
        };
  if (input.kind !== 'new' || !input.dir) return null;
  const choice = input.buildMemory ?? { enabled: true };
  if (!choice.enabled)
    return { mode: 'none', reason: 'the owner turned memory off for this build' };
  if (choice.system !== undefined) {
    if (!knownSystems.includes(choice.system))
      throw new PolicyError(`no memory store is known for the system "${choice.system}"`, {
        code: 'unknown_memory_system',
      });
    return {
      mode: 'member',
      system: choice.system,
      reason: `the new repository joins the "${choice.system}" system's memory store`,
    };
  }
  return { mode: 'repo', reason: 'a new standalone repository gets its own .memory/ store' };
}
