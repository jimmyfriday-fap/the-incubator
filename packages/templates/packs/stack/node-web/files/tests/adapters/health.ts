import { buildApp } from '@app/server/app.js';
import type { HealthResult } from '@app/features/health/index.js';
import type { FeatureAdapter } from './types.js';

interface Out {
  httpStatus: number;
  body: HealthResult;
}

/** Drives GET /health through the real app; `fault` inputs become failing dependencies. */
export const adapter: FeatureAdapter<Record<string, never>, Out> = {
  name: 'health',
  seedContext: () => ({}),
  async runStage(stage) {
    const input = (stage.input ?? {}) as { probe?: string; fault?: string };
    const app = buildApp(input.fault === 'dependency-down' ? { health: { checkDatabase: () => Promise.reject(new Error('down')) } } : {});
    const res = await app.inject({ url: input.probe === undefined ? '/health' : `/health?probe=${encodeURIComponent(input.probe)}` });
    return { httpStatus: res.statusCode, body: res.json() };
  },
  captureOutput: (out) => out.body,
  validate(captured) {
    const body = captured as HealthResult;
    return ['ok', 'degraded', 'error'].includes(body.status) ? [] : [`unexpected status ${String(body.status)}`];
  },
};
