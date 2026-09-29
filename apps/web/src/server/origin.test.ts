import { describe, expect, it } from 'vitest';
import { isAllowedHost, isAllowedOrigin } from './origin.js';

describe('origin and host checks', () => {
  it('accepts only the exact loopback origin and host', () => {
    expect(isAllowedOrigin('http://127.0.0.1:4000', 4000)).toBe(true);
    expect(isAllowedOrigin('http://localhost:4000', 4000)).toBe(false);
    expect(isAllowedOrigin('http://127.0.0.1:4001', 4000)).toBe(false);
    expect(isAllowedOrigin(undefined, 4000)).toBe(false);
    expect(isAllowedHost('127.0.0.1:4000', 4000)).toBe(true);
    expect(isAllowedHost('evil.example:4000', 4000)).toBe(false);
  });
});
