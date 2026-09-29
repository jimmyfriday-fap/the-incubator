import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { Redactor } from './redact.js';
import { SecretString } from './secret.js';

describe('Redactor', () => {
  it('redacts registered values and their encodings', () => {
    const r = new Redactor();
    const token = 'not-a-real-token/with+chars';
    r.register(token);
    const b64 = Buffer.from(`x-access-token:${token}`).toString('base64');
    const text = `a ${token} b ${encodeURIComponent(token)} c ${b64} d ${Buffer.from(token).toString('base64')}`;
    const out = r.redact(text);
    expect(out).not.toContain(token);
    expect(out).not.toContain(encodeURIComponent(token));
    expect(out).not.toContain(b64);
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(4);
  });

  it('redacts token-shaped patterns without registration', () => {
    const r = new Redactor();
    const gh = `ghp_${'a'.repeat(36)}`;
    const pat = `github_pat_${'B'.repeat(30)}`;
    const ant = `sk-ant-api03-${'c'.repeat(30)}`;
    const out = r.redact(
      `${gh} ${pat} ${ant} Authorization: Bearer abc.def x-api-key: k123456 {"authorization":"token zzz"}`,
    );
    expect(out).not.toMatch(/ghp_a|github_pat_B|sk-ant-api03-c|abc\.def|k123456|zzz/);
  });

  it('ignores very short secrets to avoid redacting everything', () => {
    const r = new Redactor();
    r.register('ab');
    expect(r.redact('abc')).toBe('abc');
    r.register('secret-value');
    r.clear();
    expect(r.redact('secret-value')).toBe('secret-value');
  });
});

describe('SecretString', () => {
  it('never serializes its value', () => {
    const r = new Redactor();
    const s = new SecretString('hunter2-hunter2', r);
    expect(String(s)).toBe('[REDACTED]');
    expect(`${String(s)}`).toBe('[REDACTED]');
    expect(JSON.stringify({ s })).toBe('{"s":"[REDACTED]"}');
    expect(inspect(s)).toBe('SecretString([REDACTED])');
    expect(s.reveal()).toBe('hunter2-hunter2');
    expect(s.isEmpty).toBe(false);
    expect(r.redact('x hunter2-hunter2 y')).toBe('x [REDACTED] y');
  });
});
