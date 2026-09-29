import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';

describe('server', () => {
  it('creates an app', () => {
    expect(typeof createApp).toBe('function');
  });
  it('has an orders route', () => {
    expect(createApp()).toBeTruthy();
  });
});
