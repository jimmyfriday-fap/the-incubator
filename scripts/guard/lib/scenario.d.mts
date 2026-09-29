export interface Assertion {
  path: string;
  op: 'eq' | 'neq' | 'contains' | 'matches' | 'exists' | 'absent' | 'gte' | 'lte' | 'length';
  value?: unknown;
}
export interface Stage {
  name: string;
  input?: Record<string, unknown>;
  assertions: Assertion[];
}
export interface Scenario {
  id: string;
  feature: string;
  title?: string;
  tags: string[];
  seed: Record<string, unknown>;
  context: Record<string, unknown>;
  mocks: { ai?: unknown[]; [k: string]: unknown };
  stages: Stage[];
}
export interface LoadedScenario {
  file: string;
  dirFeature: string;
  data: Scenario | null;
  errors: string[];
}
export interface Profile {
  suites?: string[];
  scenarioTags?: string[];
  requiresLive?: boolean;
  env?: Record<string, string>;
}
export const OPS: readonly Assertion['op'][];
export const ONBOARDING_MINIMUM: { happy: number; validation: number; fault: number };
export function getPath(obj: unknown, p: string): unknown;
export function evaluateAssertion(output: unknown, assertion: Assertion): string | null;
export function validateScenario(s: unknown): string[];
export function loadScenarios(root: string, dir?: string): LoadedScenario[];
export function selectForProfile(scenarios: LoadedScenario[], profile: Profile): LoadedScenario[];
