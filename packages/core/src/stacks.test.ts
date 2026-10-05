import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGitOps } from '@incubator/git';
import { PolicyError, ToolError, nodeExec } from '@incubator/runtime';
import { stackById } from '@incubator/spec';
import { createStackProject, locateTool, probeStack } from './stacks.js';
import { fakeStackTools } from './testing.js';

const flutter = stackById('flutter')!;
const pre = flutter.prerequisites![0]!;
const git = createGitOps(nodeExec);
const emptyDir = () => path.join(mkdtempSync(path.join(tmpdir(), 'stack ')), 'app');

/** A tool file the real `which` accepts on this platform. */
function plantTool(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, process.platform === 'win32' ? `${name}.bat` : name);
  writeFileSync(file, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');
  if (process.platform !== 'win32') chmodSync(file, 0o755);
  return file;
}

describe('finding the tool', () => {
  it('prefers PATH, then the configured path, then the directories under home', async () => {
    const { tools } = fakeStackTools();
    expect(await locateTool(pre, tools)).toMatchObject({ via: 'path' });

    const missing = fakeStackTools({ installed: false }).tools;
    expect(await locateTool(pre, missing)).toBeNull();

    const configured = plantTool(mkdtempSync(path.join(tmpdir(), 'cfg ')), 'flutter');
    expect(await locateTool(pre, { ...missing, toolPaths: { flutter: configured } })).toEqual({
      path: configured,
      via: 'config',
    });
    // A relative or non-existent configured path is ignored, never trusted.
    expect(await locateTool(pre, { ...missing, toolPaths: { flutter: 'flutter' } })).toBeNull();
    expect(
      await locateTool(pre, { ...missing, toolPaths: { flutter: path.join(tmpdir(), 'nope') } }),
    ).toBeNull();

    const home = mkdtempSync(path.join(tmpdir(), 'home '));
    const planted = plantTool(path.join(home, 'flutter', 'bin'), 'flutter');
    const found = await locateTool(pre, { ...missing, userHome: home });
    expect(found?.via).toBe('home');
    expect(found?.path.toLowerCase()).toBe(planted.toLowerCase());
  });
});

describe('probing a stack', () => {
  it('reports the version when the tool runs', async () => {
    const { tools } = fakeStackTools();
    expect(await probeStack(flutter, tools)).toMatchObject({
      ok: true,
      tool: 'flutter',
      version: 'Flutter 3.99.0 • channel stable',
    });
  });

  it('says the tool is missing, and where to get it, without running anything', async () => {
    const { tools, calls } = fakeStackTools({ installed: false });
    expect(await probeStack(flutter, tools)).toEqual({
      ok: false,
      stack: 'flutter',
      tool: 'flutter',
      install: 'https://docs.flutter.dev/get-started/install',
      reason: 'missing',
    });
    expect(calls).toEqual([]);
  });

  it('says so when the tool is there but does not run', async () => {
    const { tools } = fakeStackTools({ fail: 'version' });
    expect(await probeStack(flutter, tools)).toMatchObject({
      ok: false,
      reason: 'failed',
      detail: 'Flutter SDK is broken',
    });
  });

  it('refuses a stack that is built in', async () => {
    await expect(probeStack(stackById('node-web')!, fakeStackTools().tools)).rejects.toThrow(
      PolicyError,
    );
  });
});

describe('creating a project with the stack’s own generator', () => {
  const deps = (o: Parameters<typeof fakeStackTools>[0] = {}) => {
    const fake = fakeStackTools(o);
    return {
      ...fake,
      deps: {
        ...fake.tools,
        git,
        identity: () => Promise.resolve({ name: 'Test', email: 'test@example.invalid' }),
      },
    };
  };
  const input = (dir: string) => ({ dir, name: 'Club Events', org: 'com.example' });

  it('runs the generator with built arguments, then commits the result as the base commit', async () => {
    const { deps: d, calls } = deps();
    const dir = emptyDir();
    const r = await createStackProject(flutter, input(dir), d);
    expect(r).toMatchObject({
      status: 'created',
      stack: 'flutter',
      dir,
      version: 'Flutter 3.99.0 • channel stable',
    });
    const create = calls.find((c) => c.args[0] === 'create')!;
    expect(create.args).toEqual([
      'create',
      '--org',
      'com.example',
      '--project-name',
      'club_events',
      '--platforms=web,android,ios',
      '.',
    ]);
    expect(create.cwd).toBe(dir);
    expect(existsSync(path.join(dir, 'pubspec.yaml'))).toBe(true);
    expect(await git.headMessage(dir)).toBe('chore: flutter create');
    expect(await git.currentBranch(dir)).toBe('main');
    expect((await git.status(dir)).length).toBe(0);
    if (r.status === 'created') expect(r.files).toBe(5);
  });

  it('writes nothing and runs no generator when the tool is missing', async () => {
    const { deps: d, calls } = deps({ installed: false });
    const dir = emptyDir();
    const r = await createStackProject(flutter, input(dir), d);
    expect(r.status).toBe('missing');
    expect(existsSync(dir)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('refuses a folder that already holds files', async () => {
    const { deps: d, calls } = deps();
    const dir = emptyDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'notes.txt'), 'mine');
    await expect(createStackProject(flutter, input(dir), d)).rejects.toMatchObject({
      code: 'folder_not_empty',
    });
    expect(readFileSync(path.join(dir, 'notes.txt'), 'utf8')).toBe('mine');
    expect(calls).toEqual([]);
  });

  it('refuses a relative folder and names that cannot be used', async () => {
    const { deps: d, calls } = deps();
    await expect(createStackProject(flutter, input('relative/app'), d)).rejects.toMatchObject({
      code: 'bad_folder',
    });
    for (const bad of [
      { name: '!!!', org: 'com.example' },
      { name: 'app', org: 'x; y' },
    ])
      await expect(
        createStackProject(flutter, { dir: emptyDir(), ...bad }, d),
      ).rejects.toMatchObject({ code: 'bad_stack_names' });
    expect(calls).toEqual([]);
  });

  it('turns a failing generator into an error that says why', async () => {
    const { deps: d } = deps({ fail: 'create' });
    const err = await createStackProject(flutter, input(emptyDir()), d).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'generator_failed' });
    expect((err as Error).message).toContain('cannot create here');
  });

  it('notices a generator that finished without creating the project', async () => {
    const { deps: d } = deps({ fail: 'incomplete' });
    const err = await createStackProject(flutter, input(emptyDir()), d).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'generator_incomplete' });
    expect((err as Error).message).toContain('lib/main.dart');
  });

  it('refuses a stack that is built in', async () => {
    const { deps: d } = deps();
    await expect(
      createStackProject(stackById('python-service')!, input(emptyDir()), d),
    ).rejects.toThrow(PolicyError);
    expect(ToolError).toBeDefined();
  });
});
