import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolError } from './errors.js';
import { commandFor, nodeExec, parseCmdShim, runProcess, which } from './exec.js';
import { Logger, MemorySink } from './log.js';

const NPM_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*
`;

const PNPM_SHIM = `@SETLOCAL
@IF EXIST "%~dp0\\node.exe" (
  "%~dp0\\node.exe"  "%~dp0\\..\\typescript\\bin\\tsc" %*
) ELSE (
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\\..\\typescript\\bin\\tsc" %*
)
`;

describe('parseCmdShim', () => {
  it('recovers the script from npm shims', () => {
    expect(parseCmdShim(NPM_SHIM, 'C:\\npm\\claude.cmd')).toBe(
      'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
    );
  });
  it('recovers the script from pnpm shims', () => {
    expect(parseCmdShim(PNPM_SHIM, 'C:\\repo\\node_modules\\.bin\\tsc.cmd')).toBe(
      'C:\\repo\\node_modules\\typescript\\bin\\tsc',
    );
  });
  it('returns null for unknown formats', () => {
    expect(parseCmdShim('@echo off\r\necho hi', 'C:\\x.cmd')).toBeNull();
  });
});

describe('which', () => {
  const files = new Map<string, string>([
    ['C:\\bin\\git.exe', ''],
    ['C:\\bin\\claude.cmd', NPM_SHIM],
    ['C:\\bin\\weird.bat', '@echo off'],
    ['C:\\other\\git.cmd', PNPM_SHIM],
  ]);
  const win = {
    platform: 'win32' as const,
    env: { PATH: 'C:\\bin;C:\\other', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    exists: (p: string) => Promise.resolve(files.has(p)),
    readText: (p: string) => Promise.resolve(files.get(p) ?? ''),
  };

  it('prefers .exe and resolves shims on Windows', async () => {
    expect(await which('git', win)).toEqual({ path: 'C:\\bin\\git.exe', kind: 'native' });
    const claude = await which('claude', win);
    expect(claude?.kind).toBe('cmd-shim');
    expect(claude?.target).toMatch(/cli\.js$/);
    expect(await which('weird', win)).toEqual({ path: 'C:\\bin\\weird.bat', kind: 'cmd-shim' });
    expect(await which('missing', win)).toBeNull();
  });

  it('walks PATH on POSIX', async () => {
    const posix = {
      platform: 'linux' as const,
      env: { PATH: '/usr/bin:/opt/bin' },
      exists: (p: string) => Promise.resolve(p === '/opt/bin/tool' || p === '/opt/bin/s.mjs'),
    };
    expect(await which('tool', posix)).toEqual({ path: '/opt/bin/tool', kind: 'native' });
    expect(await which('s.mjs', posix)).toEqual({ path: '/opt/bin/s.mjs', kind: 'script' });
    expect(await which('./rel/tool', posix)).toBeNull();
  });
});

describe('commandFor', () => {
  it('never produces a shell invocation', () => {
    expect(commandFor({ path: '/x', kind: 'native' }, ['a'])).toEqual(['/x', ['a']]);
    expect(commandFor({ path: '/x.mjs', kind: 'script' }, ['a'])).toEqual([
      process.execPath,
      ['/x.mjs', 'a'],
    ]);
    expect(commandFor({ path: 'C:\\a.cmd', kind: 'cmd-shim', target: 'C:\\t.js' }, ['a'])).toEqual([
      process.execPath,
      ['C:\\t.js', 'a'],
    ]);
    expect(commandFor({ path: 'C:\\a.cmd', kind: 'cmd-shim', target: 'C:\\t.exe' }, [])).toEqual([
      'C:\\t.exe',
      [],
    ]);
    expect(() => commandFor({ path: 'C:\\a.bat', kind: 'cmd-shim' }, [])).toThrow(ToolError);
  });
});

describe('runProcess', () => {
  const node = { path: process.execPath, kind: 'native' as const };
  const resolveNode = () => Promise.resolve(node);

  it('captures output, stdin and exit code without a shell', async () => {
    const r = await runProcess(
      'node',
      ['-e', 'process.stdin.pipe(process.stdout); process.stderr.write("e"); process.exitCode = 3'],
      { timeoutMs: 10_000, stdin: 'hello $(whoami) && echo pwned' },
      resolveNode,
    );
    expect(r).toMatchObject({
      code: 3,
      stdout: 'hello $(whoami) && echo pwned',
      stderr: 'e',
      timedOut: false,
    });
  });

  it('passes env overrides and can drop the inherited environment', async () => {
    const r = await runProcess(
      'node',
      [
        '-e',
        'process.stdout.write(String(process.env.FOO) + ":" + String(process.env.INCUBATOR_SECRET_PROBE))',
      ],
      { timeoutMs: 10_000, env: { FOO: 'bar' }, inheritEnv: false },
      resolveNode,
    );
    expect(r.stdout).toBe('bar:undefined');
  });

  it('kills on timeout', async () => {
    const r = await runProcess(
      'node',
      ['-e', 'setTimeout(() => {}, 60000)'],
      { timeoutMs: 300 },
      resolveNode,
    );
    expect(r.timedOut).toBe(true);
  });

  it('tees redacted lines to the logger unless output is secret', async () => {
    const sink = new MemorySink();
    const log = new Logger([sink]);
    const script = `console.log("ghp_${'x'.repeat(36)}"); console.error("line2")`;
    await runProcess('node', ['-e', script], { timeoutMs: 10_000, log }, resolveNode);
    expect(sink.lines.join('\n')).not.toContain('ghp_x');
    expect(sink.records.map((r) => r.msg)).toContain('line2');
    const quiet = new MemorySink();
    await runProcess(
      'node',
      ['-e', 'console.log("tok")'],
      { timeoutMs: 10_000, log: new Logger([quiet]), secretOutput: true },
      resolveNode,
    );
    expect(quiet.lines).toHaveLength(0);
  });

  it('caps captured output', async () => {
    const r = await runProcess(
      'node',
      ['-e', 'process.stdout.write("x".repeat(1000))'],
      { timeoutMs: 10_000, maxBuffer: 10 },
      resolveNode,
    );
    expect(r.stdout).toBe('x'.repeat(10));
  });

  it('raises ToolError for missing binaries', async () => {
    await expect(
      nodeExec.run('definitely-not-a-binary-xyz', [], { timeoutMs: 1000 }),
    ).rejects.toThrow(/binary not found/);
  });

  it('resolves real binaries on PATH', async () => {
    const found = await nodeExec.which(path.basename(process.execPath).replace(/\.exe$/i, ''));
    expect(found).not.toBeNull();
  });
});

describe('git repository variables', () => {
  const resolveNode = () => Promise.resolve({ path: process.execPath, kind: 'native' as const });
  const vars = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX'];
  const saved = Object.fromEntries(vars.map((k) => [k, process.env[k]]));
  const probe = `process.stdout.write(JSON.stringify(${JSON.stringify(vars)}.map((k) => process.env[k] ?? null)))`;

  afterEach(() => {
    for (const k of vars) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const hooked = () => {
    for (const k of vars) process.env[k] = `inherited-${k}`;
  };
  const seen = async (bin: string, env?: Record<string, string>) =>
    JSON.parse(
      (
        await runProcess(
          bin,
          ['-e', probe],
          { timeoutMs: 10_000, ...(env ? { env } : {}) },
          resolveNode,
        )
      ).stdout,
    ) as (string | null)[];

  it('are not passed on to git, which would otherwise ignore its cwd', async () => {
    hooked();
    expect(await seen('git')).toEqual(vars.map(() => null));
    expect(await seen('C:\\Program Files\\Git\\cmd\\git.exe')).toEqual(vars.map(() => null));
    expect(await seen('/usr/bin/git')).toEqual(vars.map(() => null));
  });

  it('still reach other programs, and a caller can set them for git on purpose', async () => {
    hooked();
    expect(await seen('node')).toEqual(vars.map((k) => `inherited-${k}`));
    expect(await seen('git', { GIT_DIR: 'chosen' })).toEqual(['chosen', null, null, null, null]);
  });
});
