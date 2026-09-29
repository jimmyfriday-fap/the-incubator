import { describe, expect, it } from 'vitest';

// Live smoke against a deployed lane (INCUBATOR_LIVE=1 and BASE_URL, e.g. the staging host).
const base = process.env['BASE_URL'];

describe.skipIf(!base)('live health', () => {
  it('answers ok', async () => {
    const res = await fetch(new URL('/health', base));
    expect(res.status).toBe(200);
  });
});
