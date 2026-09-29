import { createHash } from 'node:crypto';
import { canonicalize } from './jcs.js';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `sha256:<hex>` form used in lockfiles and commit trailers. */
export function sha256Tagged(data: string | Uint8Array): string {
  return `sha256:${sha256Hex(data)}`;
}

/** Hash of the RFC 8785 canonical form of a JSON value. */
export function jsonHash(value: unknown): string {
  return sha256Tagged(canonicalize(value));
}
