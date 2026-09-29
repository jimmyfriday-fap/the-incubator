import { ExitCode } from './exit.js';

export interface ErrorOptions {
  code?: string;
  cause?: unknown;
  details?: Record<string, unknown>;
}

/** Base class: every error the Incubator raises on purpose carries an exit code. */
export abstract class IncubatorError extends Error {
  abstract readonly exitCode: ExitCode;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, defaultCode: string, opts: ErrorOptions = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.code = opts.code ?? defaultCode;
    this.details = opts.details;
  }
}

/** The tool itself broke (bad install, missing binary, unexpected response). Exit 1. */
export class ToolError extends IncubatorError {
  readonly exitCode = ExitCode.ToolError;
  constructor(message: string, opts: ErrorOptions = {}) {
    super(message, 'tool_error', opts);
  }
}

/** A policy or gate finding (invalid spec, gate failed, name taken). Exit 2. */
export class PolicyError extends IncubatorError {
  readonly exitCode = ExitCode.Policy;
  constructor(message: string, opts: ErrorOptions = {}) {
    super(message, 'policy', opts);
  }
}

/** A run parked at a gate. Parking is a gate outcome, so it exits 2 like any policy finding. */
export class ParkError extends PolicyError {
  readonly reason: string;
  readonly evidence: unknown;
  constructor(reason: string, message: string, evidence?: unknown, opts: ErrorOptions = {}) {
    super(message, { code: 'parked', ...opts });
    this.reason = reason;
    this.evidence = evidence;
  }
}

/** SIGINT / SIGTERM. Exit 130. */
export class InterruptedError extends IncubatorError {
  readonly exitCode = ExitCode.Interrupted;
  constructor(message = 'interrupted', opts: ErrorOptions = {}) {
    super(message, 'interrupted', opts);
  }
}

export function exitCodeFor(err: unknown): ExitCode {
  if (err instanceof IncubatorError) return err.exitCode;
  return ExitCode.ToolError;
}

/** One-line human summary; never includes stack traces unless verbose. */
export function formatError(err: unknown, verbose = false): string {
  if (err instanceof IncubatorError) {
    const head = `${err.name} [${err.code}]: ${err.message}`;
    return verbose && err.stack ? `${head}\n${err.stack}` : head;
  }
  if (err instanceof Error) return verbose && err.stack ? err.stack : `${err.name}: ${err.message}`;
  return String(err);
}
