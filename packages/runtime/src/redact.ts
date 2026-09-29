const PLACEHOLDER = '[REDACTED]';
const MIN_SECRET_LENGTH = 6;

/** Token-shaped patterns redacted even when the exact value was never registered. */
const PATTERNS: readonly [RegExp, string][] = [
  [/\bgh[opusr]_[A-Za-z0-9]{20,}\b/g, PLACEHOLDER],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, PLACEHOLDER],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, PLACEHOLDER],
  [/(authorization["']?\s*[:=]\s*["']?)(?:[A-Za-z]+\s+)?[^\s"',}]+/gi, `$1${PLACEHOLDER}`],
  [/(x-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, `$1${PLACEHOLDER}`],
];

/**
 * Replaces registered secret values (and their common encodings) plus token-shaped patterns.
 * Every log sink, the exec tee, the journal and SSE pass through one instance.
 */
export class Redactor {
  readonly #values = new Set<string>();
  #sorted: string[] = [];

  register(secret: string): void {
    if (secret.length < MIN_SECRET_LENGTH) return;
    const forms = [
      secret,
      encodeURIComponent(secret),
      Buffer.from(secret, 'utf8').toString('base64'),
      Buffer.from(`x-access-token:${secret}`, 'utf8').toString('base64'),
    ];
    for (const form of forms) this.#values.add(form);
    // Longest first so an encoding that contains the raw value is replaced whole.
    this.#sorted = [...this.#values].sort((a, b) => b.length - a.length);
  }

  redact(text: string): string {
    let out = text;
    for (const value of this.#sorted) {
      if (out.includes(value)) out = out.split(value).join(PLACEHOLDER);
    }
    for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
    return out;
  }

  /** Test helper: forget registered values. */
  clear(): void {
    this.#values.clear();
    this.#sorted = [];
  }
}

export const globalRedactor = new Redactor();
export const REDACTED = PLACEHOLDER;
