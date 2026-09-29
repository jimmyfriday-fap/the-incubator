import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { discoveryTurnWireSchema, partialSpecSchema, specSchema } from './schemas.js';
import type { DiscoveryTurn, IncubatorSpec } from './types.gen.js';

export interface Issue {
  code: string;
  path: string;
  message: string;
}

// why: ajv-formats is CommonJS; under NodeNext its default export arrives wrapped.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as (ajv: Ajv2020) => Ajv2020;

const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats(ajv);

const compiled = new Map<string, ValidateFunction>();
function validator(key: string, schema: Record<string, unknown>): ValidateFunction {
  let fn = compiled.get(key);
  if (!fn) {
    fn = ajv.compile(schema);
    compiled.set(key, fn);
  }
  return fn;
}

export function toIssues(errors: readonly ErrorObject[] | null | undefined): Issue[] {
  return (errors ?? []).map((e) => ({
    code: `schema.${e.keyword}`,
    path: e.instancePath || '/',
    message: `${e.instancePath || '/'} ${e.message ?? 'is invalid'}${
      e.keyword === 'additionalProperties'
        ? ` (${String((e.params as { additionalProperty?: string }).additionalProperty)})`
        : ''
    }${e.keyword === 'enum' ? `: ${JSON.stringify((e.params as { allowedValues?: unknown }).allowedValues)}` : ''}`,
  }));
}

export interface Validation<T> {
  ok: boolean;
  value?: T;
  issues: Issue[];
}

function run<T>(key: string, schema: Record<string, unknown>, value: unknown): Validation<T> {
  const fn = validator(key, schema);
  return fn(value)
    ? { ok: true, value: value as T, issues: [] }
    : { ok: false, issues: toIssues(fn.errors) };
}

export const validateSpec = (value: unknown): Validation<IncubatorSpec> =>
  run('spec', specSchema, value);
export const validateDraft = (value: unknown): Validation<Partial<IncubatorSpec>> =>
  run('partial', partialSpecSchema, value);
export const validateDiscoveryTurn = (value: unknown): Validation<DiscoveryTurn> =>
  run('turn', discoveryTurnWireSchema, value);

/** Validates any schema (compiled and cached by `$id`). */
export function validateAgainst<T>(schema: Record<string, unknown>, value: unknown): Validation<T> {
  const id = typeof schema['$id'] === 'string' ? schema['$id'] : JSON.stringify(schema);
  return run(id, schema, value);
}
