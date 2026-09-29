import { describe, expect, it } from 'vitest';
import { secureWebPreferences } from './window.js';

describe('secureWebPreferences', () => {
  it('locks the renderer down', () => {
    expect(secureWebPreferences()).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    });
  });
});
