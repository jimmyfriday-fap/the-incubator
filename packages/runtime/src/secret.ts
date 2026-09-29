import { inspect } from 'node:util';
import { globalRedactor, REDACTED, type Redactor } from './redact.js';

/**
 * Wraps a secret so it cannot be serialized, logged or string-interpolated by accident.
 * The value is registered with the Redactor on construction; `reveal()` is for the HTTP/git boundary.
 */
export class SecretString {
  readonly #value: string;

  constructor(value: string, redactor: Redactor = globalRedactor) {
    this.#value = value;
    redactor.register(value);
  }

  reveal(): string {
    return this.#value;
  }

  get isEmpty(): boolean {
    return this.#value.length === 0;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return `SecretString(${REDACTED})`;
  }
}
