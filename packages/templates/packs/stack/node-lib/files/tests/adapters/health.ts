import { health, type HealthResult } from '@app/features/health.js';
import type { FeatureAdapter } from './types.js';

/** Drives health() through the public API; `fault` inputs become a failing runtime check. */
export const adapter: FeatureAdapter<Record<string, never>, HealthResult> = {
  name: 'health',
  seedContext: () => ({}),
  runStage(stage) {
    const input = (stage.input ?? {}) as { probe?: string; fault?: string };
    const deps = input.fault === 'dependency-down' ? { checkRuntime: () => Promise.reject(new Error('down')) } : {};
    return health(input.probe === undefined ? {} : { probe: input.probe }, deps);
  },
  captureOutput: (out) => out,
  validate(captured) {
    const body = captured as HealthResult;
    return ['ok', 'degraded', 'error'].includes(body.status) ? [] : [`unexpected status ${String(body.status)}`];
  },
};
