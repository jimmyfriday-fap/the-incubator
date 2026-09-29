// Electron main process (TDD §9.3): the engine and the localhost server run in-process; the window is
// a sandboxed renderer that only speaks HTTP to 127.0.0.1. Bundled by scripts/build.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, session, shell, type WebContents } from 'electron';
import { Logger, fileSink, formatError, incubatorHome } from '@incubator/runtime';
import { createLiveEngine, type Engine, type RunStore } from '@incubator/core';
import { startServer, type RunningServer } from '@incubator/web';
import { extractArchive, type PacksArchive } from './packs-archive.js';
import {
  TEST_FAKES_FLAG,
  externalAllowed,
  leantimeHosts,
  navigationAllowed,
  secureWebPreferences,
} from './window.js';

declare const __INCUBATOR_TEST_BUILD__: boolean;

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function wiring(): Promise<{ engine: Engine; store: RunStore; log: Logger }> {
  // why: the constant is false in release builds, so the bundler drops this branch and the fakes.
  if (__INCUBATOR_TEST_BUILD__ && process.argv.includes(TEST_FAKES_FLAG)) {
    const { fakeWiring } = await import('./testing-fixtures/fakes.js');
    return fakeWiring();
  }
  const log = new Logger([fileSink(path.join(incubatorHome(), 'desktop.log'))]);
  const live = createLiveEngine({ log });
  return { engine: live.engine, store: live.store, log };
}

function lockDown(contents: WebContents, origin: string, hosts: () => string[]): void {
  contents.on('will-navigate', (event, url) => {
    if (!navigationAllowed(url, origin)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!navigationAllowed(url, origin)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (externalAllowed(url, hosts())) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function main(): Promise<void> {
  // why: the fakes exist only in test builds; a release build refuses the flag before anything starts.
  if (process.argv.includes(TEST_FAKES_FLAG) && !__INCUBATOR_TEST_BUILD__) {
    process.stderr.write(`${TEST_FAKES_FLAG} is refused: this is not a test build\n`);
    app.exit(2);
    return;
  }
  // why: every renderer is sandboxed; only an explicit --no-sandbox (root in a container) opts out.
  if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  let server: RunningServer;
  try {
    const archive = JSON.parse(
      readFileSync(path.join(appRoot, 'packs.json'), 'utf8'),
    ) as PacksArchive;
    process.env['INCUBATOR_PACKS_DIR'] = extractArchive(
      archive,
      path.join(app.getPath('userData'), 'packs'),
    );
    const { engine, store, log } = await wiring();
    server = await startServer({ engine, store, log, uiDir: path.join(appRoot, 'ui') });
    const hosts = () => {
      try {
        return leantimeHosts(store.list().map((id) => engine.finalSpec(id)));
      } catch {
        return [];
      }
    };
    const win = new BrowserWindow({
      width: 1280,
      height: 900,
      title: 'The Incubator',
      show: false,
      webPreferences: secureWebPreferences(),
    });
    lockDown(win.webContents, server.origin, hosts);
    win.once('ready-to-show', () => win.show());
    app.on('second-instance', () => {
      if (win.isMinimized()) win.restore();
      win.focus();
    });
    await win.loadURL(server.url);
  } catch (err) {
    dialog.showErrorBox('The Incubator could not start', formatError(err));
    app.exit(1);
    return;
  }
  app.on('window-all-closed', () => {
    void server.close().finally(() => app.quit());
  });
}

void main();
