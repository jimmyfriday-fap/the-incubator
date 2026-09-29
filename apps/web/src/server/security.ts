import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isAllowedHost, isAllowedOrigin } from './origin.js';

export const SESSION_COOKIE = 'inc_session';
export const CSRF_HEADER = 'x-incubator-csrf';

/** Content-Security-Policy for every response (TDD §9.1, rule 7). No inline script or style. */
export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

export const newSecret = (): string => randomBytes(32).toString('base64url');

/** Constant-time string comparison (false for different lengths without leaking where they differ). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (!Object.hasOwn(out, k)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

export interface GuardRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

export type GuardVerdict =
  | { kind: 'allow'; session: string }
  | { kind: 'bootstrap'; cookie: string }
  | { kind: 'deny'; status: 401 | 403; error: string };

const header = (h: GuardRequest['headers'], k: string): string | undefined => {
  const v = h[k];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Request authentication for the localhost server (ADR-011, TDD §9.1):
 * Host must be the exact loopback host (DNS rebinding), Origin must match when present and on every
 * non-GET, a single-use launch token is exchanged for an HttpOnly SameSite=Strict session cookie,
 * every other request needs that cookie, and mutations need the session's CSRF header.
 */
export class Guard {
  #token: string | null;
  readonly #sessions = new Map<string, { csrf: string }>();
  port = 0;

  constructor(token: string = newSecret()) {
    this.#token = token;
  }

  get launchToken(): string | null {
    return this.#token;
  }

  csrfFor(session: string): string {
    return this.#sessions.get(session)!.csrf;
  }

  check(req: GuardRequest): GuardVerdict {
    if (!this.port || !isAllowedHost(header(req.headers, 'host'), this.port))
      return { kind: 'deny', status: 403, error: 'bad host' };
    const method = req.method.toUpperCase();
    const safe = method === 'GET' || method === 'HEAD';
    const origin = header(req.headers, 'origin');
    if ((origin !== undefined || !safe) && !isAllowedOrigin(origin, this.port))
      return { kind: 'deny', status: 403, error: 'bad origin' };
    const t = req.query['t'];
    if (safe && req.path === '/' && typeof t === 'string') {
      if (!this.#token || !safeEqual(t, this.#token))
        return { kind: 'deny', status: 401, error: 'invalid or already used launch token' };
      // why: single use (threat T1): the URL may have passed through an OS handler.
      this.#token = null;
      const session = newSecret();
      this.#sessions.set(session, { csrf: newSecret() });
      return {
        kind: 'bootstrap',
        cookie: `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/`,
      };
    }
    const cookie = parseCookies(header(req.headers, 'cookie'))[SESSION_COOKIE];
    const session =
      cookie === undefined
        ? undefined
        : [...this.#sessions.keys()].find((s) => safeEqual(s, cookie));
    if (!session) return { kind: 'deny', status: 401, error: 'no session' };
    if (!safe) {
      const csrf = header(req.headers, CSRF_HEADER);
      if (!csrf || !safeEqual(csrf, this.#sessions.get(session)!.csrf))
        return { kind: 'deny', status: 403, error: 'missing or wrong CSRF token' };
    }
    return { kind: 'allow', session };
  }
}
