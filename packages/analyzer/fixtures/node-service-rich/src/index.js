import Fastify from 'fastify';
import { users } from './routes/users.js';
import { orders } from './routes/orders.js';
import { pool } from './db/pool.js';

const app = Fastify();
app.register(users);
app.register(orders);
app.get('/healthz', async () => ({ ok: true, db: await pool.ping() }));
app.listen({ port: 3000 });
