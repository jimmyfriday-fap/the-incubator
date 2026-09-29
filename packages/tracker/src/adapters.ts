import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PolicyError, ToolError, type SecretString } from '@incubator/runtime';
import { transition as checkTransition, type TicketState } from './state.js';

export interface TicketInput {
  /** Stable Incubator id, e.g. `F-reorder-alerts`. */
  id: string;
  title: string;
  lane: string;
  description: string;
}

export interface TrackerAdapter {
  readonly kind: 'local' | 'leantime' | 'fake';
  /** Idempotent: finds the ticket by its Incubator id first and only creates it when absent. */
  ensureTicket(t: TicketInput): Promise<{ ref: string; created: boolean }>;
  transition(ref: string, to: TicketState): Promise<void>;
}

export interface LocalTicket {
  id: string;
  title: string;
  lane: string;
  state: TicketState;
  plan: string | null;
  remediations: unknown[];
}

/** `.incubator/tickets/<id>.json` inside a repository (the generated repos' default tracker). */
export class LocalTracker implements TrackerAdapter {
  readonly kind = 'local' as const;
  constructor(
    private readonly root: string,
    private readonly dir = '.incubator/tickets',
  ) {}

  private file(id: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(id))
      throw new PolicyError(`invalid ticket id ${id}`, { code: 'bad_ticket' });
    return path.join(this.root, this.dir, `${id}.json`);
  }

  read(id: string): LocalTicket | null {
    const f = this.file(id);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as LocalTicket) : null;
  }

  private write(t: LocalTicket): void {
    const f = this.file(t.id);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(`${f}.tmp`, `${JSON.stringify(t, null, 2)}\n`);
    renameSync(`${f}.tmp`, f);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async so validation errors reject
  async ensureTicket(t: TicketInput): Promise<{ ref: string; created: boolean }> {
    if (this.read(t.id)) return { ref: t.id, created: false };
    this.write({
      id: t.id,
      title: t.title,
      lane: t.lane,
      state: 'TAGGED_TO_RELEASE',
      plan: null,
      remediations: [],
    });
    return { ref: t.id, created: true };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async so validation errors reject
  async transition(ref: string, to: TicketState): Promise<void> {
    const t = this.read(ref);
    if (!t) throw new PolicyError(`no ticket ${ref}`, { code: 'no_ticket' });
    if (t.state !== to) this.write({ ...t, state: checkTransition(t.state, to) });
  }
}

/** In-memory tracker for tests: records calls and supports failure injection. */
export class FakeTracker implements TrackerAdapter {
  readonly kind = 'fake' as const;
  readonly tickets = new Map<string, TicketInput & { state: TicketState }>();
  readonly calls: string[] = [];
  failNext: 'ensureTicket' | 'transition' | null = null;

  ensureTicket(t: TicketInput): Promise<{ ref: string; created: boolean }> {
    this.calls.push(`ensureTicket ${t.id}`);
    if (this.failNext === 'ensureTicket') {
      this.failNext = null;
      return Promise.reject(new ToolError('injected tracker failure'));
    }
    if (this.tickets.has(t.id)) return Promise.resolve({ ref: t.id, created: false });
    this.tickets.set(t.id, { ...t, state: 'TAGGED_TO_RELEASE' });
    return Promise.resolve({ ref: t.id, created: true });
  }

  transition(ref: string, to: TicketState): Promise<void> {
    this.calls.push(`transition ${ref} ${to}`);
    const t = this.tickets.get(ref);
    if (!t) return Promise.reject(new PolicyError(`no ticket ${ref}`));
    t.state = checkTransition(t.state, to);
    return Promise.resolve();
  }
}

/** Leantime JSON-RPC method names differ across versions, so they are configuration, not code. */
export interface LeantimeMethods {
  getAll: string;
  addTicket: string;
  updateTicket: string;
}

export const DEFAULT_LEANTIME_METHODS: LeantimeMethods = {
  getAll: 'leantime.rpc.Tickets.Tickets.getAll',
  addTicket: 'leantime.rpc.Tickets.Tickets.addTicket',
  updateTicket: 'leantime.rpc.Tickets.Tickets.patch',
};

export interface LeantimeOptions {
  baseUrl: string;
  projectId: number;
  apiKey: SecretString;
  statusMap?: Partial<Record<TicketState, number>>;
  methods?: Partial<LeantimeMethods>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export const incubatorTag = (id: string): string => `incubator:${id}`;

/**
 * Leantime over JSON-RPC 2.0 (`POST {baseUrl}/api/jsonrpc`, `x-api-key`). Tickets carry an
 * `incubator:<id>` tag, which is how `ensureTicket` finds them again (idempotent handoff).
 */
export class LeantimeTracker implements TrackerAdapter {
  readonly kind = 'leantime' as const;
  private readonly methods: LeantimeMethods;
  private seq = 0;

  constructor(private readonly o: LeantimeOptions) {
    if (
      !/^https:\/\//.test(o.baseUrl) &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(o.baseUrl)
    )
      throw new PolicyError('Leantime baseUrl must be https (or http on localhost)', {
        code: 'leantime_url',
      });
    this.methods = { ...DEFAULT_LEANTIME_METHODS, ...(o.methods ?? {}) };
  }

  async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const doFetch = this.o.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(new URL('/api/jsonrpc', this.o.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.o.apiKey.reveal() },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++this.seq, method, params }),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 30_000),
      });
    } catch (e) {
      throw new ToolError(
        `Leantime is unreachable: ${e instanceof Error ? e.message : String(e)}`,
        { code: 'leantime_unreachable' },
      );
    }
    if (res.status === 401 || res.status === 403)
      throw new PolicyError(`Leantime rejected the API key (HTTP ${res.status})`, {
        code: 'leantime_auth',
      });
    if (!res.ok)
      throw new ToolError(`Leantime HTTP ${res.status} for ${method}`, { code: 'leantime_http' });
    const body = (await res.json()) as { result?: T; error?: { code: number; message?: string } };
    if (body.error)
      throw new ToolError(
        `Leantime ${method} failed: ${body.error.code} ${body.error.message ?? ''}`.trim(),
        {
          code: 'leantime_rpc',
        },
      );
    return body.result as T;
  }

  private status(state: TicketState): number {
    const s = this.o.statusMap?.[state];
    if (s === undefined)
      throw new PolicyError(`tracker.leantime.statusMap has no status for ${state}`, {
        code: 'leantime_status',
      });
    return s;
  }

  async ensureTicket(t: TicketInput): Promise<{ ref: string; created: boolean }> {
    const all = await this.rpc<{ id: number | string; tags?: string | null }[] | null>(
      this.methods.getAll,
      {
        searchCriteria: { currentProject: this.o.projectId },
      },
    );
    const tag = incubatorTag(t.id);
    const hit = (all ?? []).find((x) =>
      (x.tags ?? '')
        .split(',')
        .map((s) => s.trim())
        .includes(tag),
    );
    if (hit) return { ref: String(hit.id), created: false };
    const id = await this.rpc<number | string | (number | string)[]>(this.methods.addTicket, {
      values: {
        headline: t.title,
        description: t.description,
        projectId: this.o.projectId,
        type: 'task',
        tags: `${tag},lane:${t.lane}`,
        status: this.status('TAGGED_TO_RELEASE'),
      },
    });
    return { ref: String(Array.isArray(id) ? id[0] : id), created: true };
  }

  async transition(ref: string, to: TicketState): Promise<void> {
    await this.rpc(this.methods.updateTicket, {
      id: Number(ref),
      params: { status: this.status(to) },
    });
  }
}
