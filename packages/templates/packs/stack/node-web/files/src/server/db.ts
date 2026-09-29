import pg from 'pg';

export type Pool = pg.Pool;

export function createPool(url: string): Pool {
  return new pg.Pool({ connectionString: url, max: 5 });
}

/** True when the database answers `select 1` within the pool's timeout. */
export async function checkDatabase(pool: Pool): Promise<boolean> {
  const result = await pool.query('select 1 as ok');
  return result.rows.length === 1;
}
