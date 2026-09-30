import { pool } from '../db/pool.js';

export async function users(app) {
  app.get('/users', async () => pool.query('select * from users'));
  app.post('/users', async (req) => pool.query('insert into users(name) values ($1)', [req.body.name]));
  app.delete('/users/:id', async (req) => pool.query('delete from users where id = $1', [req.params.id]));
}
