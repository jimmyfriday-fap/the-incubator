import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STACK_CATALOG, retrievedStacks, stackById, validStackNames } from './stacks.js';

const packs = path.resolve(import.meta.dirname, '../../templates/packs/stack');

describe('the stack catalog (ADR-027)', () => {
  it('has unique ids, and its built-in stacks are exactly the shipped packs', () => {
    const ids = STACK_CATALOG.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const builtIn = STACK_CATALOG.filter((s) => s.kind === 'built-in')
      .map((s) => s.id)
      .sort();
    expect(builtIn).toEqual(readdirSync(packs).sort());
  });

  it('never makes a retrieved stack a pack, and gives each one a generator and a prerequisite', () => {
    for (const s of retrievedStacks()) {
      expect(readdirSync(packs)).not.toContain(s.id);
      expect(s.create, s.id).toBeDefined();
      expect(
        s.prerequisites?.map((p) => p.tool),
        s.id,
      ).toContain(s.create!.tool);
      expect(s.prerequisites![0]!.install).toMatch(/^https:\/\//);
      expect(s.checks.length).toBeGreaterThan(0);
    }
    expect(stackById('flutter')?.kind).toBe('retrieved');
    expect(stackById('nope')).toBeUndefined();
  });

  it('describes every stack for the recommender, with something it fits and something it avoids', () => {
    for (const s of STACK_CATALOG) {
      expect(s.fits.length, s.id).toBeGreaterThan(0);
      expect(s.avoidWhen.length, s.id).toBeGreaterThan(0);
      expect(s.platforms.length, s.id).toBeGreaterThan(0);
    }
  });

  it('detects a Flutter app by its ecosystem and its sdk marker', () => {
    const flutter = stackById('flutter')!;
    expect(flutter.detect.ecosystem).toBe('dart');
    expect(flutter.detect.marker!.test('dependencies:\n  flutter:\n    sdk: flutter\n')).toBe(true);
    expect(flutter.detect.marker!.test('name: cli\nenvironment:\n  sdk: ^3.5.0\n')).toBe(false);
  });
});

describe('names for a generator', () => {
  it('makes a snake_case project name and keeps a reverse-domain organisation', () => {
    expect(validStackNames('Club Events!', 'com.example')).toEqual({
      project: 'club_events',
      org: 'com.example',
    });
    expect(validStackNames('  --My App--  ', 'io.acme.apps')).toEqual({
      project: 'my_app',
      org: 'io.acme.apps',
    });
  });

  it('refuses a name or organisation that is empty, starts with a digit, or is a Dart keyword', () => {
    for (const name of ['', '   ', '!!!', '9lives', 'class', 'Switch', 'x'.repeat(80)])
      expect(validStackNames(name, 'com.example'), name).toBeNull();
    for (const org of [
      '',
      'example',
      'Com.Example',
      'com..example',
      'com.example; rm -rf',
      'com.9x',
    ])
      expect(validStackNames('app', org), org).toBeNull();
  });

  it('builds generator arguments that are plain tokens even for a hostile name', () => {
    const create = stackById('flutter')!.create!;
    const names = validStackNames('x"; calc & echo %PATH% | <y>', 'com.example');
    expect(names).not.toBeNull();
    const args = create.args(names!);
    expect(args).toEqual([
      'create',
      '--org',
      'com.example',
      '--project-name',
      'x_calc_echo_path_y',
      '--platforms=web,android,ios',
      '.',
    ]);
    for (const a of args) expect(a).toMatch(/^[A-Za-z0-9_.:=+,@/-]+$/);
  });
});
