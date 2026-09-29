import { describe, expect, it } from 'vitest';
import { ToolError } from '@incubator/runtime';
import { applyJsonPatch } from './json-patch.js';

const doc = {
  steps: { lint: { args: ['.'] } },
  profiles: { quick: ['bom', 'lint'] },
  required: [{ id: 'a' }, { id: 'b' }, 'c'],
  'a/b': { '~x': 1 },
};

describe('applyJsonPatch', () => {
  it('set, merge (deep) and append-unique without mutating the input', () => {
    const before = structuredClone(doc);
    const out = applyJsonPatch('f.json', doc, [
      { op: 'set', pointer: '/new/deep', value: { x: 1 } },
      {
        op: 'merge',
        pointer: '/steps',
        value: { lint: { env: { CI: '1' } }, format: { args: [] } },
      },
      { op: 'append-unique', pointer: '/profiles/quick', value: ['lint', 'format', { k: 1 }] },
      { op: 'append-unique', pointer: '/profiles/full', value: 'bom' },
      { op: 'merge', pointer: '/fresh', value: { y: 2 } },
    ]);
    expect(doc).toEqual(before);
    expect(out).toMatchObject({
      new: { deep: { x: 1 } },
      steps: { lint: { args: ['.'], env: { CI: '1' } }, format: { args: [] } },
      profiles: { quick: ['bom', 'lint', 'format', { k: 1 }], full: ['bom'] },
      fresh: { y: 2 },
    });
  });

  it('is idempotent for set/merge/append-unique', () => {
    const ops = [
      { op: 'merge' as const, pointer: '/steps', value: { a: { b: 1 } } },
      { op: 'append-unique' as const, pointer: '/profiles/quick', value: ['x'] },
      { op: 'set' as const, pointer: '/v', value: 2 },
    ];
    const once = applyJsonPatch('f.json', doc, ops);
    expect(applyJsonPatch('f.json', once, ops)).toEqual(once);
  });

  it('removes keys, values and id-keyed entries; decodes ~0 and ~1', () => {
    const out = applyJsonPatch('f.json', doc, [
      { op: 'remove', pointer: '/steps/lint' },
      { op: 'remove-values', pointer: '/profiles/quick', value: ['lint'] },
      { op: 'remove-ids', pointer: '/required', value: 'a' },
      { op: 'set', pointer: '/a~1b/~0x', value: 2 },
      { op: 'remove', pointer: '/does/not/exist' },
    ]);
    expect(out).toMatchObject({
      steps: {},
      profiles: { quick: ['bom'] },
      required: [{ id: 'b' }, 'c'],
      'a/b': { '~x': 2 },
    });
  });

  it('replaces or merges the whole document at the root pointer', () => {
    expect(
      applyJsonPatch('f.json', { a: 1 }, [{ op: 'merge', pointer: '', value: { b: 2 } }]),
    ).toEqual({ a: 1, b: 2 });
    expect(applyJsonPatch('f.json', { a: 1 }, [{ op: 'set', pointer: '/', value: [1] }])).toEqual([
      1,
    ]);
  });

  it.each([
    [{ op: 'remove' as const, pointer: '' }, 'needs a non-root pointer'],
    [{ op: 'set' as const, pointer: 'steps', value: 1 }, 'must start with "/"'],
    [{ op: 'set' as const, pointer: '/profiles/quick/0/x', value: 1 }, 'crosses a non-object'],
    [{ op: 'set' as const, pointer: '/required/0', value: 1 }, 'must end at an object key'],
    [{ op: 'append-unique' as const, pointer: '/steps', value: 1 }, 'is not an array'],
    [{ op: 'remove-values' as const, pointer: '/steps', value: 1 }, 'is not an array'],
    [{ op: 'bogus' as never, pointer: '/x' }, 'unknown JSON patch op'],
  ])('rejects %j', (op, message) => {
    expect(() => applyJsonPatch('f.json', doc, [op])).toThrow(ToolError);
    expect(() => applyJsonPatch('f.json', doc, [op])).toThrow(message);
  });
});
