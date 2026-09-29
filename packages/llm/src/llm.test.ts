import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ParkError,
  SecretString,
  ToolError,
  MemoryKeychain,
  runProcess,
  which,
  type Exec,
} from '@incubator/runtime';
import { discoveryTurnWireSchema } from '@incubator/spec';
import { describe, expect, it } from 'vitest';
import {
  AnthropicApiAdapter,
  CliAdapter,
  FakeLlmAdapter,
  ProbeCache,
  RecordingAdapter,
  anthropicKeySource,
  capabilitiesFromHelp,
  complete,
  createLlmRegistry,
  extractJson,
  fixtureKey,
  isLlmAdapterId,
  toStructuredOutputSchema,
  unwrapCliOutput,
  type AnthropicLike,
  type CompleteRequest,
} from './index.js';

const CLAUDE_HELP = `Usage: claude [options] [command] [prompt]
Options:
  -p, --print                      Print response and exit (useful for pipes). Reads the prompt from stdin.
  --output-format <format>         Output format (only works with --print): "text", "json", or "stream-json"
  --tools <tools...>               Available tools. Use "" to disable all tools
  --disallowedTools <tools...>     Tools to deny
  --max-turns <n>                  Maximum agentic turns
  --model <model>                  Model for the current session
  --append-system-prompt <prompt>  Append a system prompt
`;
const COPILOT_HELP = `Usage: copilot [options]
  -p, --prompt <text>   Execute a prompt non-interactively
  --allow-all-tools     Allow all tools
  --model <model>       Set the AI model
`;

const schema = {
  $id: 'test-answer',
  type: 'object',
  required: ['answer'],
  additionalProperties: false,
  properties: { answer: { type: 'integer', minimum: 1 } },
};
const req = (over: Partial<CompleteRequest> = {}): CompleteRequest => ({
  schemaName: 'Answer',
  schema,
  system: 'sys',
  user: 'What is 6*7?',
  promptVersion: '1.0.0',
  timeoutMs: 20_000,
  ...over,
});

describe('adapter ids and JSON extraction', () => {
  it('recognises the five adapters', () => {
    expect(isLlmAdapterId('claude-cli')).toBe(true);
    expect(isLlmAdapterId('gpt')).toBe(false);
  });
  it('extracts JSON from prose and fences', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Sure!\n```json\n{"a": {"b": "}"}}\n```\nDone')).toEqual({ a: { b: '}' } });
    expect(extractJson('list: [1, 2] end')).toEqual([1, 2]);
    expect(extractJson('{"a": "x\\"y"}')).toEqual({ a: 'x"y' });
    expect(extractJson('{broken} then {"ok": true}')).toEqual({ ok: true });
    expect(extractJson('no json here')).toBeUndefined();
  });
});

describe('schema gate', () => {
  it('passes valid replies through', async () => {
    const fake = new FakeLlmAdapter([{ schemaName: 'Answer', response: { answer: 42 } }]);
    await expect(complete(fake, req())).resolves.toMatchObject({
      value: { answer: 42 },
      attempts: 1,
    });
  });
  it('retries once with the validation errors, then succeeds', async () => {
    const fake = new FakeLlmAdapter([
      { schemaName: 'Answer', response: { answer: 0 } },
      { schemaName: 'Answer', response: { answer: 42 } },
    ]);
    const r = await complete(fake, req());
    expect(r.attempts).toBe(2);
    expect(fake.calls[1]?.user).toMatch(/previous reply was rejected[\s\S]*\/answer must be >= 1/);
  });
  it('parks after a second failure, including semantic checks', async () => {
    const fake = new FakeLlmAdapter([
      { schemaName: 'Answer', response: { $text: 'I cannot answer that' } },
      { schemaName: 'Answer', response: { answer: 41 } },
    ]);
    const extraCheck = (v: { answer: number }) =>
      v.answer === 42 ? [] : [{ code: 'x', path: '/answer', message: 'wrong' }];
    const err = await complete(fake, req(), { extraCheck }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ParkError);
    expect((err as ParkError).reason).toBe('llm_schema');
    expect((err as ParkError).exitCode).toBe(2);
  });
  it('wraps unexpected adapter errors as tool errors', async () => {
    const broken = {
      id: 'fake' as const,
      probe: () => Promise.reject(new Error('x')),
      invoke: () => Promise.reject(new Error('socket hang up')),
    };
    await expect(complete(broken, req())).rejects.toBeInstanceOf(ToolError);
  });
});

describe('capability probing', () => {
  it('derives flags from help text instead of hard-coding them', () => {
    const caps = capabilitiesFromHelp('2.1.0 (Claude Code)\n', CLAUDE_HELP, '/bin/claude');
    expect(caps.flags).toEqual({
      printMode: ['-p'],
      jsonOutput: ['--output-format', 'json'],
      streamJson: ['--output-format', 'stream-json'],
      disableTools: ['--tools', ''],
      maxTurns: '--max-turns',
      model: '--model',
      systemPrompt: '--append-system-prompt',
    });
    expect(caps.eligible).toEqual({ discovery: true, analysis: true, handoff: true });
    expect(caps.version).toBe('2.1.0 (Claude Code)');
  });
  it('marks CLIs without JSON output as ineligible, with reasons', () => {
    const caps = capabilitiesFromHelp('1.0', COPILOT_HELP);
    expect(caps.eligible.discovery).toBe(false);
    expect(caps.reasons.join()).toMatch(/no JSON output mode/);
  });
});

function fakeCliDir(help: string, reply: string, mode = 'ok'): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'fake-cli-'));
  const script = path.join(dir, 'fake-agent.mjs');
  copyFileSync(new URL('./testing-fixtures/fake-cli.mjs', import.meta.url), script);
  writeFileSync(path.join(dir, 'help.txt'), help);
  writeFileSync(path.join(dir, 'reply.txt'), reply);
  writeFileSync(path.join(dir, 'mode.txt'), mode);
  if (process.platform === 'win32') {
    writeFileSync(
      path.join(dir, 'fake-agent.cmd'),
      `@SETLOCAL\r\n@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\fake-agent.mjs" %*\r\n) ELSE (\r\n  node  "%~dp0\\fake-agent.mjs" %*\r\n)\r\n`,
    );
  } else {
    const bin = path.join(dir, 'fake-agent');
    writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(bin, 0o755);
  }
  return dir;
}

function execWith(dir: string): Exec {
  // Only the fake CLI is visible: a real agent CLI on the developer's PATH must not leak into tests.
  const env = { ...process.env, PATH: dir, Path: dir };
  const resolver = (name: string) => which(name, { env });
  return { which: resolver, run: (bin, args, opts) => runProcess(bin, args, opts, resolver) };
}

describe('CliAdapter (real subprocess)', () => {
  it('runs headless with tools disabled, an empty cwd, allowlisted env and stdin prompt', async () => {
    const reply = JSON.stringify({
      type: 'result',
      result: 'Here you go:\n```json\n{"answer": 42}\n```',
      total_cost_usd: 0.012,
      model: 'm1',
    });
    const dir = fakeCliDir(CLAUDE_HELP, reply);
    process.env['INCUBATOR_TEST_SECRET'] = 'must-not-leak';
    const adapter = new CliAdapter({
      id: 'claude-cli',
      bin: 'fake-agent',
      exec: execWith(dir),
      model: 'opus',
    });
    const r = await complete(adapter, req());
    delete process.env['INCUBATOR_TEST_SECRET'];
    expect(r).toMatchObject({ value: { answer: 42 }, costUsd: 0.012, model: 'm1' });
    const call = JSON.parse(readFileSync(path.join(dir, 'last-call.json'), 'utf8')) as {
      args: string[];
      cwd: string;
      cwdEntries: string[];
      envKeys: string[];
      stdin: string;
    };
    expect(call.args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--tools',
      '',
      '--model',
      'opus',
      '--append-system-prompt',
      'sys',
    ]);
    expect(call.cwdEntries).toEqual([]);
    expect(path.basename(call.cwd)).toMatch(/^incubator-llm-/);
    expect(call.envKeys).not.toContain('INCUBATOR_TEST_SECRET');
    expect(call.stdin).toContain('What is 6*7?');
    expect(call.stdin).toContain('"minimum":1');
  });
  it('reports exits, refuses ineligible CLIs and caches probes', async () => {
    const failing = fakeCliDir(CLAUDE_HELP, '', 'fail');
    await expect(
      new CliAdapter({ id: 'claude-cli', bin: 'fake-agent', exec: execWith(failing) }).invoke(
        req(),
      ),
    ).rejects.toThrow(/exited 3: boom/);
    const noJson = fakeCliDir(COPILOT_HELP, '');
    await expect(
      new CliAdapter({ id: 'copilot-cli', bin: 'fake-agent', exec: execWith(noJson) }).invoke(
        req(),
      ),
    ).rejects.toThrow(/cannot be used headless/);
    const cacheFile = path.join(mkdtempSync(path.join(tmpdir(), 'probe-')), 'probe.json');
    const cache = new ProbeCache(cacheFile);
    const caps = await cache.get(execWith(failing), 'fake-agent');
    expect(caps.version).toBe('9.9.9 (Fake Agent)');
    expect(readFileSync(cacheFile, 'utf8')).toContain('9.9.9');
    expect((await new ProbeCache(cacheFile).get(execWith(failing), 'fake-agent')).flags).toEqual(
      caps.flags,
    );
    expect((await cache.get(execWith(failing), 'definitely-missing-cli')).installed).toBe(false);
  });
  it('times out', async () => {
    const hang = fakeCliDir(CLAUDE_HELP, '', 'hang');
    await expect(
      new CliAdapter({ id: 'claude-cli', bin: 'fake-agent', exec: execWith(hang) }).invoke(
        req({ timeoutMs: 1500 }),
      ),
    ).rejects.toThrow(/timed out/);
  });
  it('unwraps CLI envelopes', () => {
    expect(unwrapCliOutput('not json')).toEqual({ text: 'not json' });
    expect(unwrapCliOutput('{"response":"{}","cost_usd":0.5}')).toEqual({
      text: '{}',
      costUsd: 0.5,
    });
    expect(unwrapCliOutput('{"answer":1}')).toEqual({ value: { answer: 1 } });
    expect(unwrapCliOutput('[1]')).toEqual({ value: [1] });
    expect(() => unwrapCliOutput('{"is_error":true,"result":"quota"}')).toThrow(/quota/);
  });
});

describe('AnthropicApiAdapter', () => {
  function fakeClient(response: object) {
    const calls: unknown[] = [];
    const client: AnthropicLike = {
      beta: {
        messages: {
          create: ((body: unknown, opts: unknown) => {
            calls.push({ body, opts });
            return Promise.resolve(response);
          }) as AnthropicLike['beta']['messages']['create'],
        },
      },
    };
    return { client, calls };
  }
  const key = () => Promise.resolve(new SecretString('sk-ant-test-key-000000000000000000000'));

  it('uses structured outputs, effort and server-side fallbacks with the default model', async () => {
    const { client, calls } = fakeClient({
      stop_reason: 'end_turn',
      model: 'claude-opus-5-5',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '{"answer":42}' },
      ],
    });
    const a = new AnthropicApiAdapter({ apiKey: key, clientFactory: () => client });
    await expect(complete(a, req())).resolves.toMatchObject({
      value: { answer: 42 },
      model: 'claude-opus-5-5',
    });
    const { body, opts } = calls[0] as { body: Record<string, unknown>; opts: unknown };
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    expect(body).not.toHaveProperty('tool_choice');
    expect(opts).toEqual({ timeout: 20_000 });
    expect(JSON.stringify(body['output_config'])).not.toContain('minimum');
  });
  it('parks on refusal, fails clearly without a key, and can disable fallbacks', async () => {
    const { client } = fakeClient({
      stop_reason: 'refusal',
      stop_details: { category: 'cyber' },
      content: [],
    });
    await expect(
      new AnthropicApiAdapter({ apiKey: key, clientFactory: () => client }).invoke(req()),
    ).rejects.toMatchObject({ reason: 'llm_refusal' });
    const none = new AnthropicApiAdapter({ apiKey: () => Promise.resolve(null) });
    await expect(none.invoke(req())).rejects.toThrow(/no Anthropic API key/);
    expect((await none.probe()).eligible.discovery).toBe(false);
    const { client: c2, calls } = fakeClient({
      stop_reason: 'end_turn',
      model: 'm',
      content: [{ type: 'text', text: '{}' }],
    });
    await new AnthropicApiAdapter({
      apiKey: key,
      fallbacks: false,
      model: 'claude-sonnet-5-5',
      effort: 'high',
      clientFactory: () => c2,
    }).invoke(req());
    expect((calls[0] as { body: object }).body).not.toHaveProperty('fallbacks');
    expect((await new AnthropicApiAdapter({ apiKey: key }).probe()).eligible).toEqual({
      discovery: true,
      analysis: true,
      handoff: false,
    });
  });
  it('adapts schemas for structured outputs', () => {
    const out = toStructuredOutputSchema(discoveryTurnWireSchema) as {
      properties: { draftSpec: { additionalProperties: boolean } };
    };
    const text = JSON.stringify(out);
    for (const k of [
      '"minLength"',
      '"maxLength"',
      '"minimum"',
      '"pattern"',
      '"$schema":"https',
      '"minItems"',
    ])
      expect(text).not.toContain(k);
    expect(out.properties.draftSpec.additionalProperties).toBe(false);
    expect(toStructuredOutputSchema({ type: 'object' })).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {},
    });
  });
  it('reads the key from the keychain first, then the environment', async () => {
    const kc = new MemoryKeychain();
    expect(await anthropicKeySource(kc, {})()).toBeNull();
    expect(
      (await anthropicKeySource(kc, { ANTHROPIC_API_KEY: 'env-key-123456' })())?.reveal(),
    ).toBe('env-key-123456');
    await kc.set('incubator', 'anthropic', 'kc-key-123456');
    expect(
      (await anthropicKeySource(kc, { ANTHROPIC_API_KEY: 'env-key-123456' })())?.reveal(),
    ).toBe('kc-key-123456');
  });
});

describe('fake and recording adapters', () => {
  it('checks keys, schema names and supports rekeying', async () => {
    const r = req();
    const good = new FakeLlmAdapter([
      { key: fixtureKey(r), schemaName: 'Answer', response: { answer: 1 } },
    ]);
    await expect(good.invoke(r)).resolves.toEqual({ value: { answer: 1 } });
    expect(good.remaining).toBe(0);
    await expect(good.invoke(r)).rejects.toMatchObject({ code: 'fixture_missing' });
    await expect(
      new FakeLlmAdapter([{ key: 'stale', schemaName: 'Answer', response: {} }]).invoke(r),
    ).rejects.toMatchObject({ code: 'fixture_key_mismatch' });
    await expect(
      new FakeLlmAdapter([{ schemaName: 'Other', response: {} }]).invoke(r),
    ).rejects.toMatchObject({ code: 'fixture_mismatch' });
    expect(fixtureKey({ ...r, user: 'What is 6*7?  \r\n' })).toBe(fixtureKey(r));

    const dir = mkdtempSync(path.join(tmpdir(), 'fixtures-'));
    writeFileSync(
      path.join(dir, '01-answer.json'),
      JSON.stringify({ key: 'stale', schemaName: 'Answer', response: { answer: 2 } }),
    );
    await new FakeLlmAdapter({ dir }, { rekey: true }).invoke(r);
    expect(JSON.parse(readFileSync(path.join(dir, '01-answer.json'), 'utf8'))).toMatchObject({
      key: fixtureKey(r),
    });
    await expect(new FakeLlmAdapter({ dir }).invoke(r)).resolves.toEqual({ value: { answer: 2 } });
    expect((await good.probe()).eligible.discovery).toBe(true);
  });
  it('records live exchanges as keyed fixtures', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rec-'));
    const inner = new FakeLlmAdapter([{ schemaName: 'Answer', response: { $text: 'raw' } }]);
    const rec = new RecordingAdapter(inner, dir);
    expect(rec.id).toBe('fake');
    await rec.invoke(req());
    expect((await rec.probe()).installed).toBe(true);
    const [file] = readdirSync(dir);
    expect(JSON.parse(readFileSync(path.join(dir, file!), 'utf8'))).toMatchObject({
      key: fixtureKey(req()),
      response: { $text: 'raw' },
    });
    const again = new RecordingAdapter(
      new FakeLlmAdapter([{ schemaName: 'Answer', response: { answer: 3 } }]),
      dir,
    );
    await again.invoke(req());
    expect(readdirSync(dir).sort()).toEqual(['01-Answer.json', '02-Answer.json']);
  });
});

describe('registry', () => {
  it('selects the first eligible adapter or explains why none is', async () => {
    const dir = fakeCliDir(COPILOT_HELP, '');
    const home = mkdtempSync(path.join(tmpdir(), 'home-'));
    const reg = createLlmRegistry({
      exec: execWith(dir),
      keychain: new MemoryKeychain(),
      env: { INCUBATOR_HOME: home },
      extra: [new FakeLlmAdapter([])],
    });
    const probes = await reg.probeAll();
    expect(Object.keys(probes).sort()).toEqual([
      'anthropic-api',
      'claude-cli',
      'copilot-cli',
      'cursor-cli',
      'fake',
    ]);
    await expect(reg.select('discovery')).rejects.toThrow(
      /no LLM adapter is available for discovery/,
    );
    expect((await reg.select('discovery', 'fake')).id).toBe('fake');
    const kc = new MemoryKeychain();
    await kc.set('incubator', 'anthropic', 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx');
    const reg2 = createLlmRegistry({
      exec: execWith(dir),
      keychain: kc,
      env: { INCUBATOR_HOME: home },
      config: { preferred: 'anthropic-api' },
    });
    expect((await reg2.select('analysis')).id).toBe('anthropic-api');
  });
});
