import { PolicyError, SecretString, type Keychain } from '@incubator/runtime';
import { LeantimeTracker, type LeantimeTicket } from '@incubator/tracker';
import {
  DEFAULT_DENIED_ACTIONS,
  DEFAULT_HUMAN_ONLY_ACTIONS,
  DEFAULT_RUN_CEILINGS,
  completeSpec,
  slugify,
  validateDraft,
  validateSemantics,
  validateSpec,
  type IncubatorSpec,
} from '@incubator/spec';
import type { IncubatorConfig } from './config.js';

/**
 * Custom App requests (the Incubator side). A customer's build request becomes a Leantime ticket in the
 * `custom-app-request` project. The operator types the ticket number; this module reads the ticket, pulls the
 * machine-readable spec block out of it and turns it into a draft spec plus a list of what is still missing.
 * Only the fenced `incubator-spec-draft` block is machine-critical; the sections around it are for the reader.
 */

/** The largest spec block read from a ticket; anything bigger is refused, not truncated. */
export const SPEC_BLOCK_MAX_BYTES = 32 * 1024;
/** The largest ticket body looked at. */
export const TICKET_BODY_MAX_BYTES = 256 * 1024;
const FIELD_MAX = 4000;

/** The run ceiling for a Custom App build: the runbook's $10, 45 minutes, 150 turns and 400 tool calls. */
export const INTAKE_RUN_CEILINGS = { ...DEFAULT_RUN_CEILINGS };

export interface IntakeRequest {
  leantimeTicketId: number;
  headline: string;
  who: string;
  problem: string;
  outcome: string;
  /** The status WordPress reported for the request, when the ticket carries one. */
  wpStatus?: string;
  contact: string;
  openQuestions?: string;
}

export interface IntakeResult {
  /** A complete spec: the ticket's draft merged over the defaults. */
  draft: IncubatorSpec;
  /** What is missing or invalid, in words the operator can act on. */
  gaps: string[];
  request: IntakeRequest;
}

export interface IntakeTicket {
  id: number;
  projectId: number;
  headline: string;
  description: string;
}

const fail = (message: string, code: string): never => {
  throw new PolicyError(message, { code });
};

/** Leantime may hand back rich text; reduce it to plain Markdown-ish lines before parsing. */
export function plainText(body: string): string {
  if (!/<\/?[a-z][^>]*>/i.test(body)) return body.replace(/\r\n?/g, '\n');
  return body
    .replace(/\r\n?/g, '\n')
    .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|pre|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Splits the body into sections by heading, keyed by the lower-cased heading text. */
export function sectionsOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let key: string | null = null;
  let buf: string[] = [];
  let fenced = false;
  const flush = (): void => {
    if (key !== null && !out.has(key)) out.set(key, buf.join('\n').trim());
  };
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const h = fenced ? null : /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      key = h[1]!
        .replace(/[*_`:]/g, '')
        .trim()
        .toLowerCase();
      buf = [];
    } else buf.push(line);
  }
  flush();
  return out;
}

const SPEC_FENCE = /```[ \t]*incubator-spec-draft[^\n]*\n([\s\S]*?)(?:\n[ \t]*)?```/;

/** The JSON object in the ticket's `incubator-spec-draft` block, or null when there is no block. */
export function extractSpecBlock(text: string): Record<string, unknown> | null {
  const m = SPEC_FENCE.exec(text);
  if (!m) return null;
  const raw = m[1]!;
  if (Buffer.byteLength(raw, 'utf8') > SPEC_BLOCK_MAX_BYTES)
    return fail(
      `the spec block in the ticket is larger than ${SPEC_BLOCK_MAX_BYTES / 1024} KB`,
      'intake_block_too_large',
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return fail(
      `the spec block in the ticket is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      'intake_bad_block',
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    return fail('the spec block in the ticket must be a JSON object', 'intake_bad_block');
  return parsed as Record<string, unknown>;
}

const cap = (s: string | undefined): string => (s ?? '').trim().slice(0, FIELD_MAX);

function pick(sections: Map<string, string>, ...names: string[]): string {
  for (const n of names) {
    for (const [k, v] of sections) if (k === n || k.startsWith(n)) return cap(v);
  }
  return '';
}

function wpStatusOf(text: string): string | undefined {
  const m =
    /^[ \t]*[-*]?[ \t]*\**(?:wp|wordpress)[ _-]?status\**[ \t]*[:=][ \t]*\**(.+?)\**[ \t]*$/im.exec(
      text,
    );
  return m?.[1] ? cap(m[1]) : undefined;
}

/** Reads a Custom App request ticket into a draft spec, the gaps still to fill and the request details. */
export function parseIntakeTicket(ticket: IntakeTicket, opts: { projectId: number }): IntakeResult {
  if (ticket.projectId !== opts.projectId)
    fail(
      `ticket ${ticket.id} is not in the Custom App request project (it is in project ${ticket.projectId})`,
      'intake_wrong_project',
    );
  if (Buffer.byteLength(ticket.description, 'utf8') > TICKET_BODY_MAX_BYTES)
    fail(`ticket ${ticket.id} is too large to read`, 'intake_ticket_too_large');
  const text = plainText(ticket.description);
  const sections = sectionsOf(text);
  const gaps: string[] = [];

  const request: IntakeRequest = {
    leantimeTicketId: ticket.id,
    headline: cap(ticket.headline),
    who: pick(sections, 'who'),
    problem: pick(sections, 'problem today', 'problem'),
    outcome: pick(sections, 'wanted outcome', 'outcome'),
    contact: pick(sections, 'contact'),
  };
  const wp = wpStatusOf(text);
  if (wp) request.wpStatus = wp;
  const open = pick(sections, 'open questions');
  if (open) request.openQuestions = open;
  for (const [field, label] of [
    ['who', 'Who'],
    ['problem', 'Problem today'],
    ['outcome', 'Wanted outcome'],
    ['contact', 'Contact'],
  ] as const)
    if (!request[field]) gaps.push(`The ticket has no "${label}" section.`);

  const block = extractSpecBlock(text);
  let draft: Record<string, unknown> = {};
  if (!block) gaps.push('The ticket has no incubator-spec-draft block; the defaults are used.');
  else {
    const v = validateDraft(block);
    if (v.ok) draft = block;
    else
      gaps.push(
        'The spec draft in the ticket is not valid, so it was left out: ' +
          v.issues.map((i) => i.message).join('; '),
      );
  }

  const intent = (draft['intent'] ?? {}) as { narrative?: unknown; coreFeatures?: unknown };
  const project = (draft['project'] ?? {}) as { name?: unknown };
  const narrativeGiven = typeof intent.narrative === 'string' && intent.narrative.trim() !== '';
  const nameGiven = typeof project.name === 'string' && project.name.trim() !== '';
  const filled: Record<string, unknown> = { ...draft };
  if (!narrativeGiven) {
    const fallback = [request.problem, request.outcome].filter(Boolean).join('\n\n');
    filled['intent'] = { ...(draft['intent'] as object | undefined), narrative: fallback };
    gaps.push(
      fallback
        ? 'The draft has no narrative; the problem and wanted outcome were used.'
        : 'The draft has no narrative.',
    );
  }
  if (!nameGiven && request.headline) {
    filled['project'] = {
      ...(draft['project'] as object | undefined),
      name: request.headline.slice(0, 100),
      slug: slugify(request.headline),
    };
    gaps.push('The draft has no project name; the ticket headline was used.');
  } else if (!nameGiven) gaps.push('The draft has no project name.');
  if (!Array.isArray(intent.coreFeatures) || intent.coreFeatures.length === 0)
    gaps.push('The draft lists no features.');

  const spec = hardenSpec(completeSpec(filled).spec);
  const sv = validateSpec(spec);
  for (const i of sv.issues) gaps.push(`Spec: ${i.message}`);
  if (sv.ok) for (const i of validateSemantics(spec)) gaps.push(`Spec: ${i.message}`);
  return { draft: spec, gaps, request };
}

const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])];

/**
 * A ticket (and an edited form) is not trusted to loosen the run: the ceilings are the runbook's, and the
 * denied and human-only action lists keep at least the defaults.
 */
export function hardenSpec(spec: IncubatorSpec): IncubatorSpec {
  return {
    ...spec,
    agents: {
      ...spec.agents,
      runCeilings: { ...INTAKE_RUN_CEILINGS },
      deniedActions: union(spec.agents.deniedActions, DEFAULT_DENIED_ACTIONS),
      humanOnlyActions: union(spec.agents.humanOnlyActions, DEFAULT_HUMAN_ONLY_ACTIONS),
    },
  };
}

/** The intake address from the configuration, checked: https, or http on localhost; no credentials. */
export function intakeConfig(config: IncubatorConfig): { baseUrl: string; projectId: number } {
  const lt = config.intake?.leantime;
  if (!lt)
    return fail(
      'Custom App requests are not set up: add intake.leantime to ~/.incubator/config.json',
      'intake_unconfigured',
    );
  const { baseUrl, projectId } = lt;
  if (typeof baseUrl !== 'string' || !Number.isInteger(projectId) || projectId <= 0)
    return fail('intake.leantime needs a baseUrl and a numeric projectId', 'intake_bad_config');
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return fail('intake.leantime.baseUrl is not a URL', 'intake_bad_config');
  }
  const local = u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if ((u.protocol !== 'https:' && !local) || u.username || u.password)
    return fail(
      'intake.leantime.baseUrl must be https (or http on localhost) with no credentials in it',
      'intake_bad_config',
    );
  return { baseUrl, projectId };
}

/** The https host of the intake Leantime, or null when it is not configured (or not https). */
export function intakeHost(config: IncubatorConfig): string | null {
  try {
    const u = new URL(intakeConfig(config).baseUrl);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** What the web server needs from the host to serve Custom App requests. */
export interface IntakeSource {
  /** True when `intake.leantime` is set (a bad value still reads as configured; `fetch` then says why). */
  configured(): boolean;
  /** The https host of the intake Leantime (for the desktop's external-link allow-list), or null. */
  host(): string | null;
  /** Reads ticket `id` and parses it. Throws `PolicyError` with an `intake_*` or `leantime_*` code. */
  fetch(id: number): Promise<IntakeResult>;
}

export function createIntakeSource(deps: {
  config: () => IncubatorConfig;
  keychain: Keychain;
  env: NodeJS.ProcessEnv;
  /** Tests only. */
  fetchImpl?: typeof fetch;
}): IntakeSource {
  return {
    configured: () => Boolean(deps.config().intake?.leantime),
    host: () => intakeHost(deps.config()),
    async fetch(id) {
      const { baseUrl, projectId } = intakeConfig(deps.config());
      const key =
        ((await deps.keychain.available())
          ? await deps.keychain.get('incubator', 'leantime')
          : null) ?? deps.env['INCUBATOR_LEANTIME_TOKEN'];
      if (!key)
        return fail(
          'no Leantime API key: incubator auth set leantime, or INCUBATOR_LEANTIME_TOKEN',
          'no_leantime_key',
        );
      const tracker = new LeantimeTracker({
        baseUrl,
        projectId,
        apiKey: new SecretString(key),
        ...(deps.fetchImpl ? { fetch: deps.fetchImpl } : {}),
      });
      const t: LeantimeTicket | null = await tracker.getTicket(id);
      if (!t) return fail(`Leantime has no ticket ${id}`, 'intake_not_found');
      return parseIntakeTicket(t, { projectId });
    },
  };
}
