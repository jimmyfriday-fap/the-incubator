import pg from 'pg';

const client = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const pool = {
  query: (sql, args) => client.query(sql, args),
  ping: async () => (await client.query('select 1')).rowCount === 1,
};
