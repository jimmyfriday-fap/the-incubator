import { describe, expect, it } from 'vitest';
import { jsonHash, sha256Hex, sha256Tagged } from './hash.js';
import { canonicalize, stableJson } from './jcs.js';

describe('canonicalize (RFC 8785)', () => {
  it('sorts keys by code unit and strips whitespace', () => {
    expect(canonicalize({ b: 1, a: [true, null, 'x'], c: { z: 0, y: -0 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"y":0,"z":0}}',
    );
    expect(canonicalize({ '\u20ac': 1, '\r': 2, a: 3 })).toBe('{"\\r":2,"a":3,"€":1}');
  });

  it('serializes numbers like ECMAScript and drops undefined members', () => {
    expect(canonicalize([1e21, 0.1, 1.5e-7, 10])).toBe('[1e+21,0.1,1.5e-7,10]');
    expect(canonicalize({ a: undefined, b: 2 })).toBe('{"b":2}');
    expect(canonicalize([undefined])).toBe('[null]');
  });

  it('rejects values JSON cannot represent', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalize(() => 1)).toThrow(TypeError);
  });

  it('is stable regardless of insertion order', () => {
    expect(jsonHash({ a: 1, b: 2 })).toBe(jsonHash({ b: 2, a: 1 }));
    expect(jsonHash({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('hash helpers', () => {
  it('hashes strings and bytes identically', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Tagged(new TextEncoder().encode('abc'))).toBe(`sha256:${sha256Hex('abc')}`);
  });
});

describe('stableJson', () => {
  it('pretty prints with a trailing LF and optional deep key sort', () => {
    expect(stableJson({ b: 1, a: { d: 1, c: 2 } }, { sortKeys: true })).toBe(
      '{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}\n',
    );
    expect(stableJson({ b: 1, a: 2 })).toBe('{\n  "b": 1,\n  "a": 2\n}\n');
  });
});
