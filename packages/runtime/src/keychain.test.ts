import { describe, expect, it } from 'vitest';
import { MemoryKeychain, OsKeychain } from './keychain.js';

describe('MemoryKeychain', () => {
  it('stores, reads and deletes', async () => {
    const k = new MemoryKeychain();
    expect(await k.available()).toBe(true);
    expect(await k.get('s', 'a')).toBeNull();
    await k.set('s', 'a', 'v');
    expect(await k.get('s', 'a')).toBe('v');
    expect(await k.delete('s', 'a')).toBe(true);
    expect(await k.delete('s', 'a')).toBe(false);
  });
});

describe('OsKeychain', () => {
  it('degrades gracefully when no OS keychain is reachable', async () => {
    const k = new OsKeychain();
    const available = await k.available();
    expect(typeof available).toBe('boolean');
    if (!available) {
      expect(await k.get('incubator', 'nobody')).toBeNull();
      expect(await k.delete('incubator', 'nobody')).toBe(false);
    }
  });
});
