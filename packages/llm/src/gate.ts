import { ParkError, ToolError, type Logger } from '@incubator/runtime';
import { validateAgainst, type Issue } from '@incubator/spec';
import { extractJson } from './extract.js';
import type { CompleteRequest, LlmAdapter, RawReply } from './types.js';

export interface GateResult<T> {
  value: T;
  attempts: number;
  costUsd: number;
  model?: string;
}

function parse(reply: RawReply): unknown {
  if (reply.value !== undefined) return reply.value;
  return reply.text === undefined ? undefined : extractJson(reply.text);
}

function describe(issues: Issue[]): string {
  return issues
    .slice(0, 20)
    .map((i) => `- ${i.message}`)
    .join('\n');
}

/**
 * Schema gate (ADR-007): invoke, parse, validate. On failure retry exactly once with the
 * validation errors appended; a second failure parks the run (`llm_schema`, exit 2).
 * `extraCheck` lets callers add semantic checks that count as schema failures.
 */
export async function complete<T>(
  adapter: LlmAdapter,
  req: CompleteRequest,
  opts: { log?: Logger; extraCheck?: (value: T) => Issue[] } = {},
): Promise<GateResult<T>> {
  let request = req;
  let costUsd = 0;
  let lastIssues: Issue[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    let reply: RawReply;
    try {
      reply = await adapter.invoke(request);
    } catch (err) {
      if (err instanceof ParkError || err instanceof ToolError) throw err;
      throw new ToolError(
        `${adapter.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    costUsd += reply.costUsd ?? 0;
    const value = parse(reply);
    const result =
      value === undefined
        ? {
            ok: false,
            issues: [{ code: 'llm.no_json', path: '/', message: 'reply contained no JSON value' }],
          }
        : validateAgainst<T>(req.schema, value);
    const issues = result.ok ? (opts.extraCheck?.(value as T) ?? []) : result.issues;
    if (issues.length === 0) {
      return {
        value: value as T,
        attempts: attempt,
        costUsd,
        ...(reply.model ? { model: reply.model } : {}),
      };
    }
    lastIssues = issues;
    opts.log?.warn('llm reply failed the schema gate', {
      adapter: adapter.id,
      attempt,
      schema: req.schemaName,
      issues: issues.slice(0, 10).map((x) => x.message),
    });
    request = {
      ...req,
      user: `${req.user}\n\n## Your previous reply was rejected\nIt did not match the required ${req.schemaName} JSON schema:\n${describe(issues)}\nReply again with only corrected JSON.`,
    };
  }
  throw new ParkError(
    'llm_schema',
    `${adapter.id} returned invalid ${req.schemaName} twice; run parked`,
    {
      adapter: adapter.id,
      schema: req.schemaName,
      issues: lastIssues.slice(0, 20),
    },
  );
}
