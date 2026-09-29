import { describe, expect, it } from 'vitest';
import { checkDatabase, createPool } from '@app/server/db.js';

// Runs in CI against the compose/service Postgres (DATABASE_URL); reported as skipped elsewhere.
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('database', () => {
  it('answers after bootstrap and has applied every migration', async () => {
    const pool = createPool(url!);
    try {
      expect(await checkDatabase(pool)).toBe(true);
      const applied = await pool.query('select name from _migrations order by name');
      expect(applied.rows.length).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  });
});
