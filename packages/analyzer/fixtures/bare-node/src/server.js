import express from 'express';

export function createApp() {
  const app = express();
  app.get('/orders', (_req, res) => res.json([]));
  return app;
}
