import type { SessionInfo } from '../api-types.js';

let session: Promise<SessionInfo> | null = null;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly evidence?: unknown,
  ) {
    super(message);
  }
}

async function parse<T>(r: Response): Promise<T> {
  if (r.status === 204) return null as T;
  const body = (await r.json().catch(() => ({}))) as { error?: string; evidence?: unknown };
  if (!r.ok) throw new ApiError(r.status, body.error ?? `HTTP ${r.status}`, body.evidence);
  return body as T;
}

/** CSRF token for this session (the session cookie itself is HttpOnly and sent by the browser). */
export function getSession(): Promise<SessionInfo> {
  session ??= fetch('/api/session').then((r) => parse<SessionInfo>(r));
  return session;
}

export async function get<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path));
}

export async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const { csrf } = await getSession();
  return parse<T>(
    await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-incubator-csrf': csrf },
      body: JSON.stringify(body),
    }),
  );
}
