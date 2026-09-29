import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';
import { checkDatabase, createPool } from './db.js';
import { loadEnv } from './env.js';

loadEnv();
const url = process.env['DATABASE_URL'];
const pool = url ? createPool(url) : undefined;
const app = buildApp(pool ? { health: { checkDatabase: () => checkDatabase(pool) } } : {});

const web = path.resolve('dist/web');
if (existsSync(web)) await app.register(fastifyStatic, { root: web });

const port = Number(process.env['PORT'] ?? 3000);
await app.listen({ host: process.env['HOST'] ?? '0.0.0.0', port });
process.stdout.write(`listening on :${port}\n`);
