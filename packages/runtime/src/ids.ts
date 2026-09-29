import { randomBytes } from 'node:crypto';
import type { Clock } from './clock.js';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** `yyyymmdd-HHMMSS-<6 base32>` in UTC. */
export function newRunId(clock: Clock, random: (n: number) => Uint8Array = randomBytes): string {
  const d = clock.now();
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const suffix = [...random(6)].map((b) => BASE32[b % 32]).join('');
  return `${date}-${time}-${suffix}`;
}

export const RUN_ID_PATTERN = /^\d{8}-\d{6}-[a-z2-7]{6}$/;

/** `yyyymmdd` (UTC) for branch names such as `incubator/adopt-<yyyymmdd>`. */
export function dateStamp(clock: Clock): string {
  const d = clock.now();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
