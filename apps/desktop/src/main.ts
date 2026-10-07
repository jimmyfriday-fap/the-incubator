// Electron main process (TDD §9.3): the engine and the localhost server run in-process; the window is
// a sandboxed renderer that only speaks HTTP to 127.0.0.1. Bundled by scripts/build.mjs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  session,
  shell,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import { Logger, fileSink, formatError, incubatorHome } from '@incubator/runtime';
import { createLiveEngine, type Engine, type RunStore, type Settings } from '@incubator/core';
import { startServer, type HostCapabilities, type RunningServer } from '@incubator/web';
import { extractArchive, type PacksArchive } from './packs-archive.js';
import {
  TEST_FAKES_FLAG,
  externalAllowed,
  historyActionForCommand,
  historyActionForKey,
  leantimeHosts,
  navigationAllowed,
  secureWebPreferences,
} from './window.js';

declare const __INCUBATOR_TEST_BUILD__: boolean;

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Wiring {
  engine: Engine;
  store: RunStore;
  log: Logger;
  settings?: Settings;
  /** Test builds only: a folder picker that answers without opening a dialog. */
  pickFolder?: HostCapabilities['pickFolder'];
}

async function wiring(): Promise<Wiring> {
  // why: the constant is false in release builds, so the bundler drops this branch and the fakes.
  if (__INCUBATOR_TEST_BUILD__ && process.argv.includes(TEST_FAKES_FLAG)) {
    const { fakeWiring } = await import('./testing-fixtures/fakes.js');
    return fakeWiring();
  }
  const log = new Logger([fileSink(path.join(incubatorHome(), 'desktop.log'))]);
  const live = createLiveEngine({ log });
  return { engine: live.engine, store: live.store, log, settings: live.settings };
}

/**
 * The native folder dialog (ADR-022). It runs here in the main process and the renderer reaches it
 * over the same HTTP routes as in the browser: no preload, no IPC (ADR-012).
 */
function folderDialog(
  window: () => BrowserWindow | undefined,
): NonNullable<HostCapabilities['pickFolder']> {
  return async (purpose) => {
    const options: Electron.OpenDialogOptions = {
      title:
        purpose === 'new'
          ? 'Choose the folder for the new repository'
          : 'Choose the folder that contains your local repository',
      // why: createDirectory lets the owner make the new repository's folder in the dialog itself.
      properties: purpose === 'new' ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
    };
    const win = window();
    const r = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return r.canceled ? null : (r.filePaths[0] ?? null);
  };
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

/** Back and forward through the page history, from the menu, the keyboard and the mouse. */
function goThroughHistory(contents: WebContents, action: 'back' | 'forward'): void {
  const h = contents.navigationHistory;
  if (action === 'back' && h.canGoBack()) h.goBack();
  if (action === 'forward' && h.canGoForward()) h.goForward();
}

function historyControls(win: BrowserWindow): void {
  const contents = win.webContents;
  contents.on('before-input-event', (event, input) => {
    const action = historyActionForKey(input, process.platform);
    if (!action) return;
    event.preventDefault();
    goThroughHistory(contents, action);
  });
  // why: the mouse's back and forward buttons reach Windows apps as app commands.
  win.on('app-command', (_e, command) => {
    const action = historyActionForCommand(command);
    if (action) goThroughHistory(contents, action);
  });
}

/** A small menu: the default one has no Back or Forward and a Developer Tools entry the owner never needs. */
function applicationMenu(win: () => BrowserWindow | undefined): Menu {
  const go = (action: 'back' | 'forward') => () => {
    const w = win();
    if (w) goThroughHistory(w.webContents, action);
  };
  const mac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [mac ? { role: 'close' as const } : { role: 'quit' as const }] },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Back', accelerator: mac ? 'Cmd+[' : 'Alt+Left', click: go('back') },
        { label: 'Forward', accelerator: mac ? 'Cmd+]' : 'Alt+Right', click: go('forward') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...(app.isPackaged
          ? []
          : [{ type: 'separator' as const }, { role: 'toggleDevTools' as const }]),
      ],
    },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
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
  // why: the single-instance lock and the extracted packs live in userData, so a test build (or a
  // test harness) must not share it with an installed release build, or it hands off and quits.
  const userData = process.env['INCUBATOR_DESKTOP_USER_DATA'];
  if (userData) app.setPath('userData', path.resolve(userData));
  else if (__INCUBATOR_TEST_BUILD__)
    app.setPath('userData', `${app.getPath('userData')} (test build)`);
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
    const { engine, store, log, settings, pickFolder } = await wiring();
    const windows: { main?: BrowserWindow } = {};
    server = await startServer({
      engine,
      store,
      log,
      ...(settings ? { settings } : {}),
      uiDir: path.join(appRoot, 'ui'),
      host: { pickFolder: pickFolder ?? folderDialog(() => windows.main) },
    });
    const hosts = () => {
      try {
        return leantimeHosts(store.list().map((id) => engine.finalSpec(id)));
      } catch {
        return [];
      }
    };
    const main = new BrowserWindow({
      width: 1280,
      height: 900,
      title: 'The Incubator',
      // The taskbar and window icon (plan 031); the packaged app carries it next to the UI.
      icon: path.join(appRoot, 'icon.png'),
      show: false,
      webPreferences: secureWebPreferences(),
    });
    windows.main = main;
    lockDown(main.webContents, server.origin, hosts);
    historyControls(main);
    Menu.setApplicationMenu(applicationMenu(() => windows.main));
    main.once('ready-to-show', () => main.show());
    app.on('second-instance', () => {
      if (main.isMinimized()) main.restore();
      main.focus();
    });
    await main.loadURL(server.url);
  } catch (err) {
    // why: always leave a trace on stderr; a modal would block headless test builds forever.
    process.stderr.write(`The Incubator could not start: ${formatError(err)}\n`);
    if (!__INCUBATOR_TEST_BUILD__)
      dialog.showErrorBox('The Incubator could not start', formatError(err));
    app.exit(1);
    return;
  }
  app.on('window-all-closed', () => {
    void server.close().finally(() => app.quit());
  });
}

void main();
