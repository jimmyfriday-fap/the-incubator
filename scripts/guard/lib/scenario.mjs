// Scenario contract layer: loading, structural validation and assertion evaluation.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const OPS = ['eq', 'neq', 'contains', 'matches', 'exists', 'absent', 'gte', 'lte', 'length'];
export const ONBOARDING_MINIMUM = { happy: 1, validation: 2, fault: 1 };

/** Reads `a.b[0].c` style paths. */
export function getPath(obj, p) {
  if (p === '' || p === '$') return obj;
  const parts = p
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Returns null when the assertion holds, else a human-readable failure. */
export function evaluateAssertion(output, { path: p, op, value }) {
  const actual = getPath(output, p);
  const show = (v) => JSON.stringify(v);
  switch (op) {
    case 'eq':
      return deepEqual(actual, value) ? null : `${p}: expected ${show(value)}, got ${show(actual)}`;
    case 'neq':
      return !deepEqual(actual, value) ? null : `${p}: expected not ${show(value)}`;
    case 'contains':
      if (typeof actual === 'string')
        return actual.includes(value)
          ? null
          : `${p}: ${show(actual)} does not contain ${show(value)}`;
      if (Array.isArray(actual))
        return actual.some((x) => deepEqual(x, value)) ? null : `${p}: array lacks ${show(value)}`;
      return `${p}: cannot apply contains to ${show(actual)}`;
    case 'matches':
      return typeof actual === 'string' && new RegExp(value).test(actual)
        ? null
        : `${p}: ${show(actual)} does not match /${value}/`;
    case 'exists':
      return actual !== undefined ? null : `${p}: expected to exist`;
    case 'absent':
      return actual === undefined ? null : `${p}: expected to be absent, got ${show(actual)}`;
    case 'gte':
      return typeof actual === 'number' && actual >= value
        ? null
        : `${p}: expected >= ${value}, got ${show(actual)}`;
    case 'lte':
      return typeof actual === 'number' && actual <= value
        ? null
        : `${p}: expected <= ${value}, got ${show(actual)}`;
    case 'length':
      return actual !== null && actual !== undefined && actual.length === value
        ? null
        : `${p}: expected length ${value}, got ${show(actual?.length)}`;
    default:
      return `${p}: unknown op ${op}`;
  }
}

/** Structural check mirroring schemas/scenario.schema.json (the toolkit stays dependency-free). */
export function validateScenario(s) {
  const errors = [];
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(s)) return ['scenario must be an object'];
  if (typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(s.id))
    errors.push('id must be kebab-case');
  if (typeof s.feature !== 'string' || !s.feature) errors.push('feature is required');
  if (!Array.isArray(s.tags) || s.tags.length === 0) errors.push('tags must be a non-empty array');
  for (const k of ['seed', 'context', 'mocks'])
    if (!isObj(s[k])) errors.push(`${k} must be an object`);
  if (isObj(s.mocks) && s.mocks.ai !== undefined && !Array.isArray(s.mocks.ai))
    errors.push('mocks.ai must be an array');
  if (!Array.isArray(s.stages) || s.stages.length === 0)
    errors.push('stages must be a non-empty array');
  else
    s.stages.forEach((st, i) => {
      if (typeof st.name !== 'string') errors.push(`stages[${i}].name is required`);
      if (!Array.isArray(st.assertions) || st.assertions.length === 0)
        errors.push(`stages[${i}].assertions must be non-empty`);
      else
        st.assertions.forEach((a, j) => {
          if (typeof a.path !== 'string')
            errors.push(`stages[${i}].assertions[${j}].path is required`);
          if (!OPS.includes(a.op))
            errors.push(`stages[${i}].assertions[${j}].op must be one of ${OPS.join(', ')}`);
        });
    });
  return errors;
}

/** Loads every `<dir>/<feature>/*.json` scenario. */
export function loadScenarios(root, dir = 'tests/scenarios') {
  const base = path.join(root, dir);
  const out = [];
  let features;
  try {
    features = readdirSync(base).filter((d) => statSync(path.join(base, d)).isDirectory());
  } catch {
    return out;
  }
  for (const feature of features.sort()) {
    for (const f of readdirSync(path.join(base, feature))
      .filter((x) => x.endsWith('.json'))
      .sort()) {
      const rel = `${dir}/${feature}/${f}`;
      let data;
      try {
        data = JSON.parse(readFileSync(path.join(base, feature, f), 'utf8'));
      } catch (e) {
        out.push({
          file: rel,
          dirFeature: feature,
          data: null,
          errors: [`invalid JSON: ${e.message}`],
        });
        continue;
      }
      const errors = validateScenario(data);
      if (data && data.feature !== feature)
        errors.push(`feature "${data.feature}" does not match directory "${feature}"`);
      out.push({ file: rel, dirFeature: feature, data, errors });
    }
  }
  return out;
}

/** Scenarios selected by a profile: tag intersection, or all for ["*"]. */
export function selectForProfile(scenarios, profile) {
  const tags = profile.scenarioTags ?? [];
  return scenarios.filter(
    (s) => s.data && (tags.includes('*') || s.data.tags.some((t) => tags.includes(t))),
  );
}
