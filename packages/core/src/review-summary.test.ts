import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { completeSpec } from '@incubator/spec';
import { reviewSummaryUserPrompt } from './review-summary.js';

const spec = completeSpec(
  JSON.parse(
    readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../templates/fixtures/combos/node-lib.in-repo.package-release.json',
      ),
      'utf8',
    ),
  ) as Record<string, unknown>,
).spec;
const input = { kind: 'new', request: 'A small library.', spec, detected: null, digest: null };

describe('the review-summary prompt (plan 021)', () => {
  it('names the owner corrections only when there are some', () => {
    const text = reviewSummaryUserPrompt({ ...input, corrections: ['Add a bump feature.'] });
    expect(text).toContain("## The owner's corrections at review\n- Add a bump feature.\n");
    expect(reviewSummaryUserPrompt({ ...input, corrections: [] })).toBe(
      reviewSummaryUserPrompt(input),
    );
    expect(reviewSummaryUserPrompt(input)).not.toContain('corrections');
  });
});
