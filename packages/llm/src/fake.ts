import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sha256Hex, ToolError } from '@incubator/runtime';
import type { Capabilities, CompleteRequest, LlmAdapter, RawReply } from './types.js';

/** One recorded or hand-written model turn. */
export interface FixtureTurn {
  /** `sha256(promptVersion ‖ schemaName ‖ normalized user prompt)`; omitted in hand-written fixtures. */
  key?: string;
  schemaName: string;
  note?: string;
  /** A JSON value, or `{ "$text": "..." }` for a raw text reply (malformed replies in tests). */
  response: unknown;
}

export function normalizePrompt(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();
}

export function fixtureKey(
  req: Pick<CompleteRequest, 'promptVersion' | 'schemaName' | 'user'>,
): string {
  return sha256Hex(`${req.promptVersion}\0${req.schemaName}\0${normalizePrompt(req.user)}`);
}

export function loadFixtures(dir: string): FixtureTurn[] {
  return readdirSync(dir)
    .filter((f) => /^\d+.*\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as FixtureTurn);
}

/**
 * Replays fixture turns in order. A turn with a `key` must match the request's key, so prompt drift
 * is caught (the error prints the actual key). `INCUBATOR_FIXTURE_REKEY=1` with a `dir` writes the
 * actual keys back into the fixture files instead.
 */
export class FakeLlmAdapter implements LlmAdapter {
  readonly id = 'fake' as const;
  readonly calls: CompleteRequest[] = [];
  #index = 0;
  readonly #turns: FixtureTurn[];

  constructor(
    turns: FixtureTurn[] | { dir: string },
    private readonly opts: { rekey?: boolean } = {
      rekey: process.env['INCUBATOR_FIXTURE_REKEY'] === '1',
    },
  ) {
    this.#turns = Array.isArray(turns) ? turns : loadFixtures(turns.dir);
    this.dir = Array.isArray(turns) ? undefined : turns.dir;
  }
  private readonly dir: string | undefined;

  get remaining(): number {
    return this.#turns.length - this.#index;
  }

  probe(): Promise<Capabilities> {
    return Promise.resolve({
      installed: true,
      version: 'fake (recorded fixtures)',
      flags: {},
      stdinPrompt: true,
      eligible: { discovery: true, analysis: true, handoff: true },
      reasons: [],
    });
  }

  invoke(req: CompleteRequest): Promise<RawReply> {
    this.calls.push(req);
    const turn = this.#turns[this.#index];
    if (!turn)
      return Promise.reject(
        new ToolError(`fake LLM has no fixture for call ${this.#index + 1} (${req.schemaName})`, {
          code: 'fixture_missing',
          details: { key: fixtureKey(req) },
        }),
      );
    if (turn.schemaName !== req.schemaName) {
      return Promise.reject(
        new ToolError(
          `fixture ${this.#index + 1} is for ${turn.schemaName}, request wants ${req.schemaName}`,
          { code: 'fixture_mismatch' },
        ),
      );
    }
    const key = fixtureKey(req);
    if (this.opts.rekey && this.dir) {
      const file = readdirSync(this.dir)
        .filter((f) => /^\d+.*\.json$/.test(f))
        .sort()[this.#index];
      if (file)
        writeFileSync(path.join(this.dir, file), `${JSON.stringify({ ...turn, key }, null, 2)}\n`);
    } else if (turn.key && turn.key !== key) {
      return Promise.reject(
        new ToolError(
          `fixture ${this.#index + 1} key mismatch: prompt changed (actual key ${key})`,
          { code: 'fixture_key_mismatch', details: { expected: turn.key, actual: key } },
        ),
      );
    }
    this.#index++;
    const r = turn.response as { $text?: unknown } | null;
    if (r && typeof r === 'object' && typeof r.$text === 'string')
      return Promise.resolve({ text: r.$text });
    return Promise.resolve({ value: turn.response });
  }
}

/** Wraps a live adapter and records every exchange as a keyed fixture (`INCUBATOR_RECORD=1`). */
export class RecordingAdapter implements LlmAdapter {
  #n = 0;
  constructor(
    private readonly inner: LlmAdapter,
    private readonly dir: string,
  ) {}
  get id(): LlmAdapter['id'] {
    return this.inner.id;
  }
  probe(): Promise<Capabilities> {
    return this.inner.probe();
  }
  async invoke(req: CompleteRequest): Promise<RawReply> {
    const reply = await this.inner.invoke(req);
    mkdirSync(this.dir, { recursive: true });
    const turn: FixtureTurn = {
      key: fixtureKey(req),
      schemaName: req.schemaName,
      note: `recorded from ${this.inner.id}`,
      response: reply.value ?? { $text: reply.text ?? '' },
    };
    // Continue numbering from what is already there: the registry wraps each select() anew.
    const existing = readdirSync(this.dir).filter((f) => /^\d+.*\.json$/.test(f)).length;
    this.#n = Math.max(this.#n, existing) + 1;
    writeFileSync(
      path.join(this.dir, `${String(this.#n).padStart(2, '0')}-${req.schemaName}.json`),
      `${JSON.stringify(turn, null, 2)}\n`,
    );
    return reply;
  }
}
