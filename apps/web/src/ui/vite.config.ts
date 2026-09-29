import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

// The UI is served by the localhost server from apps/web/dist/ui (TDD §9.2).
export default defineConfig({
  root: here,
  base: '/',
  plugins: [react()],
  build: {
    outDir: path.resolve(here, '../../dist/ui'),
    emptyOutDir: true,
    // why: the server's CSP forbids inline script; keep every asset a same-origin file.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
});
