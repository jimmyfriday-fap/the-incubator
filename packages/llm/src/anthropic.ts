import Anthropic from '@anthropic-ai/sdk';
import { ParkError, ToolError, type SecretString } from '@incubator/runtime';
import type { Capabilities, CompleteRequest, JsonSchema, LlmAdapter, RawReply } from './types.js';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const UNSUPPORTED = new Set([
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'pattern',
  'patternProperties',
  '$schema',
  '$id',
  'title',
]);

/**
 * Adapts a JSON Schema to what structured outputs accept: drops unsupported constraints and forces
 * `additionalProperties: false` on every object. The full schema is still enforced client-side by
 * the gate, so nothing is lost.
 */
export function toStructuredOutputSchema(schema: JsonSchema): JsonSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (UNSUPPORTED.has(k)) continue;
      if (k === 'properties' || k === '$defs') {
        out[k] = Object.fromEntries(
          Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, walk(pv)]),
        );
      } else out[k] = walk(v);
    }
    if (out['type'] === 'object' || out['properties'] !== undefined) {
      out['additionalProperties'] = false;
      out['properties'] ??= {};
    }
    return out;
  };
  return walk(schema) as JsonSchema;
}

/** The slice of the SDK client this adapter uses (lets tests inject a fake). */
export interface AnthropicLike {
  beta: { messages: { create: Anthropic['beta']['messages']['create'] } };
}

export interface AnthropicAdapterOptions {
  apiKey: () => Promise<SecretString | null>;
  model?: string;
  effort?: Effort;
  /** Server-side refusal fallback (`fallbacks: "default"`); on by default. */
  fallbacks?: boolean;
  clientFactory?: (apiKey: string) => AnthropicLike;
}

export class AnthropicApiAdapter implements LlmAdapter {
  readonly id = 'anthropic-api' as const;
  constructor(private readonly opts: AnthropicAdapterOptions) {}

  async probe(): Promise<Capabilities> {
    const key = await this.opts.apiKey();
    const ok = key !== null && !key.isEmpty;
    return {
      installed: ok,
      version: `@anthropic-ai/sdk model=${this.opts.model ?? DEFAULT_ANTHROPIC_MODEL}`,
      flags: {},
      stdinPrompt: true,
      eligible: { discovery: ok, analysis: ok, handoff: false },
      reasons: ok
        ? ['not a coding agent (handoff needs a local CLI)']
        : ['no Anthropic API key (keychain or ANTHROPIC_API_KEY)'],
    };
  }

  async invoke(req: CompleteRequest): Promise<RawReply> {
    const key = await this.opts.apiKey();
    if (!key || key.isEmpty) {
      throw new ToolError(
        'no Anthropic API key: run `incubator auth set anthropic` or set ANTHROPIC_API_KEY',
        {
          code: 'anthropic_no_key',
        },
      );
    }
    const client = (
      this.opts.clientFactory ?? ((apiKey: string) => new Anthropic({ apiKey, maxRetries: 2 }))
    )(key.reveal());
    const fallbacks = this.opts.fallbacks ?? true;
    const res = await client.beta.messages.create(
      {
        model: this.opts.model ?? DEFAULT_ANTHROPIC_MODEL,
        max_tokens: 16000,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        output_config: {
          effort: this.opts.effort ?? 'medium',
          format: { type: 'json_schema', schema: toStructuredOutputSchema(req.schema) },
        },
        ...(fallbacks
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {}),
      },
      { timeout: req.timeoutMs },
    );
    if (res.stop_reason === 'refusal') {
      throw new ParkError('llm_refusal', 'the model declined the request; run parked', {
        category: res.stop_details?.category ?? null,
      });
    }
    const text = res.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { text, model: res.model };
  }
}
