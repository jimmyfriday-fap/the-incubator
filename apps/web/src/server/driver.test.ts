import { describe, expect, it } from 'vitest';
import { ParkError } from '@incubator/runtime';
import type { AskedQuestion } from '@incubator/core';
import { WebPrompter } from './driver.js';

const asked = (key: string): AskedQuestion => ({
  key,
  question: `Question about ${key}?`,
  impact: 5,
  options: [
    { value: 'a', label: 'A', recommended: true },
    { value: 'b', label: 'B', recommended: false },
  ],
});

describe('WebPrompter.ask', () => {
  it('answers a round with no questions at once (plan 051)', async () => {
    await expect(new WebPrompter().ask([])).resolves.toEqual([]);
  });

  it('parks needs_input when there are questions and no answers yet', async () => {
    const err = await new WebPrompter().ask([asked('deploy.target')]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ParkError);
    expect((err as ParkError).reason).toBe('needs_input');
  });

  it('hands back the submitted answers once, for the pending round', async () => {
    const answers = [{ key: 'deploy.target', value: 'a', source: 'user' as const }];
    const prompter = new WebPrompter(answers);
    await expect(prompter.ask([asked('deploy.target')])).resolves.toEqual(answers);
    await expect(prompter.ask([asked('deploy.target')])).rejects.toBeInstanceOf(ParkError);
  });
});
