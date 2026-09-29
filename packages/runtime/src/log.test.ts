import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock.js';
import { Logger, MemorySink, consoleSink, fileSink, nullLogger } from './log.js';
import { Redactor } from './redact.js';
import { SecretString } from './secret.js';

describe('Logger', () => {
  it('redacts at the sink and filters by level', () => {
    const r = new Redactor();
    const token = new SecretString('super-secret-value', r);
    const all = new MemorySink();
    const warnOnly = new MemorySink('warn');
    const log = new Logger([all, warnOnly], { run: 'r1' }, r, new FixedClock()).child({
      step: 's',
    });
    log.info('using token super-secret-value', {
      token,
      raw: token.reveal(),
      err: new Error('boom'),
    });
    log.warn('careful');
    expect(all.lines).toHaveLength(2);
    expect(all.lines[0]).not.toContain('super-secret-value');
    expect(all.records[0]).toMatchObject({
      run: 'r1',
      step: 's',
      token: '[REDACTED]',
      ts: '2026-01-01T00:00:00.000Z',
    });
    expect((all.records[0]?.['err'] as { message: string }).message).toBe('boom');
    expect(warnOnly.records.map((x) => x.msg)).toEqual(['careful']);
  });

  it('writes JSONL files and human console lines', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'inc-log-'));
    const file = path.join(dir, 'nested', 'x.log');
    const out = new PassThrough();
    let text = '';
    out.on('data', (b: Buffer) => (text += b.toString()));
    const log = new Logger([fileSink(file), consoleSink('info', out)]);
    log.debug('hidden from console', { n: 1n });
    log.error('bad');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ n: '1' });
    expect(text).toBe('ERROR: bad\n');
    nullLogger().info('nothing');
  });
});
