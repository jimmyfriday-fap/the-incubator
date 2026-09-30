import { pool } from '../db/pool.js';
import { users } from './users.js';

export async function orders(app) {
  await app.register(users);
  app.get('/orders', async () => pool.query('select * from orders'));
  app.put('/orders/:id', async (req) => pool.query('update orders set state=$1', [req.body.state]));
}
