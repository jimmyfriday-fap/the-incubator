export * from './types.gen.js';
export * from './constants.js';
export * from './schemas.js';
export * from './validate.js';
export * from './paths.js';
export * from './defaults.js';
export * from './semantics.js';
export * from './serialize.js';

import { INCUBATOR_SPEC_VERSION } from './constants.js';

export function isSupportedSpecVersion(version: unknown): boolean {
  return version === INCUBATOR_SPEC_VERSION;
}
