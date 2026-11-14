/**
 * The MVP cut. A feature may carry `mvp: true` (the smallest set that makes the product usable). When any
 * feature is marked, only the marked ones are built in a run; the others keep their tickets and are built later.
 * When none is marked, every feature is built, as before the flag existed.
 */
export interface MvpMarked {
  mvp?: boolean | undefined;
}

/** True when the owner or the model drew an MVP line (at least one feature is marked). */
export function hasMvpCut(features: readonly MvpMarked[]): boolean {
  return features.some((f) => f.mvp === true);
}

/** The features this run builds. */
export function builtFeatures<T extends MvpMarked>(features: readonly T[]): T[] {
  return hasMvpCut(features) ? features.filter((f) => f.mvp === true) : [...features];
}

/** The features left for a later run (none when no MVP line is drawn). */
export function laterFeatures<T extends MvpMarked>(features: readonly T[]): T[] {
  return hasMvpCut(features) ? features.filter((f) => f.mvp !== true) : [];
}
