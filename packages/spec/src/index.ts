/** Spec format version this build reads and writes. */
export const INCUBATOR_SPEC_VERSION = '1.0';

export function isSupportedSpecVersion(version: unknown): boolean {
  return version === INCUBATOR_SPEC_VERSION;
}
