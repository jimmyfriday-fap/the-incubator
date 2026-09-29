import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { systemClock, type Clock } from './clock.js';
import { globalRedactor, type Redactor } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogRecord {
  ts: string;
  level: LogLevel;
  msg: string;
  [field: string]: unknown;
}

export interface LogSink {
  minLevel?: LogLevel;
  /** `line` is the redacted JSON line; `record` is the parsed redacted record. */
  write(line: string, record: LogRecord): void;
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error)
    return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export class Logger {
  constructor(
    private readonly sinks: LogSink[],
    private readonly bindings: Record<string, unknown> = {},
    private readonly redactor: Redactor = globalRedactor,
    private readonly clock: Clock = systemClock,
  ) {}

  child(bindings: Record<string, unknown>): Logger {
    return new Logger(this.sinks, { ...this.bindings, ...bindings }, this.redactor, this.clock);
  }

  addSink(sink: LogSink): void {
    this.sinks.push(sink);
  }

  log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
    const raw = { ts: this.clock.now().toISOString(), level, msg, ...this.bindings, ...fields };
    const line = this.redactor.redact(JSON.stringify(raw, replacer));
    const record = JSON.parse(line) as LogRecord;
    for (const sink of this.sinks) {
      if (ORDER[level] >= ORDER[sink.minLevel ?? 'debug']) sink.write(line, record);
    }
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    this.log('debug', msg, fields);
  }
  info(msg: string, fields?: Record<string, unknown>): void {
    this.log('info', msg, fields);
  }
  warn(msg: string, fields?: Record<string, unknown>): void {
    this.log('warn', msg, fields);
  }
  error(msg: string, fields?: Record<string, unknown>): void {
    this.log('error', msg, fields);
  }
}

/** Appends JSONL to a file (created with parent dirs). */
export function fileSink(file: string, minLevel: LogLevel = 'debug'): LogSink {
  mkdirSync(path.dirname(file), { recursive: true });
  return {
    minLevel,
    write(line) {
      appendFileSync(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
    },
  };
}

/** Keeps records in memory; used by tests and by the SSE fan-out. */
export class MemorySink implements LogSink {
  readonly lines: string[] = [];
  readonly records: LogRecord[] = [];
  constructor(public minLevel: LogLevel = 'debug') {}
  write(line: string, record: LogRecord): void {
    this.lines.push(line);
    this.records.push(record);
  }
}

/** Human-readable stderr sink. */
export function consoleSink(
  minLevel: LogLevel = 'info',
  stream: NodeJS.WritableStream = process.stderr,
): LogSink {
  return {
    minLevel,
    write(_line, record) {
      const prefix = record.level === 'info' ? '' : `${record.level.toUpperCase()}: `;
      stream.write(`${prefix}${record.msg}\n`);
    },
  };
}

export function nullLogger(): Logger {
  return new Logger([]);
}
