export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Deterministic clock for tests; `advance` moves it forward. */
export class FixedClock implements Clock {
  #ms: number;
  constructor(iso = '2026-01-01T00:00:00.000Z') {
    this.#ms = Date.parse(iso);
  }
  now(): Date {
    return new Date(this.#ms);
  }
  advance(ms: number): void {
    this.#ms += ms;
  }
}
