/** BrowserWindow webPreferences: sandboxed renderer, no Node, no preload bridge. */
export function secureWebPreferences(): {
  sandbox: true;
  contextIsolation: true;
  nodeIntegration: false;
  webSecurity: true;
} {
  return { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true };
}

/** Launch argument that swaps in the fakes; honoured only by builds made with INCUBATOR_TEST_BUILD=1. */
export const TEST_FAKES_FLAG = '--incubator-test-fakes';

/** In-app navigation stays on the local server's origin (TDD §9.3 navigation lockdown). */
export function navigationAllowed(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Links that may open in the user's browser: https only, and only GitHub or a Leantime host that a
 * run's spec names. Everything else is dropped.
 */
export function externalAllowed(url: string, extraHosts: readonly string[] = []): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return host === 'github.com' || extraHosts.map((h) => h.toLowerCase()).includes(host);
}

/** Leantime hosts from the specs of known runs (for `externalAllowed`). */
export function leantimeHosts(specs: readonly unknown[]): string[] {
  const hosts = new Set<string>();
  for (const s of specs) {
    const base = (s as { tracker?: { leantime?: { baseUrl?: unknown } } } | null)?.tracker?.leantime
      ?.baseUrl;
    if (typeof base !== 'string') continue;
    try {
      const u = new URL(base);
      if (u.protocol === 'https:') hosts.add(u.hostname.toLowerCase());
    } catch {
      // not a URL: ignore
    }
  }
  return [...hosts];
}

export type HistoryAction = 'back' | 'forward';

/** The keyboard input Electron reports before the page sees it (the fields this needs). */
export interface KeyInput {
  type: string;
  key: string;
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
}

/** Alt+Left / Alt+Right (Windows, Linux) and Cmd+[ / Cmd+] (macOS) move through the page history. */
export function historyActionForKey(input: KeyInput, platform: string): HistoryAction | null {
  if (input.type !== 'keyDown' || input.shift) return null;
  if (platform === 'darwin') {
    if (!input.meta || input.alt || input.control) return null;
    return input.key === '[' ? 'back' : input.key === ']' ? 'forward' : null;
  }
  if (!input.alt || input.control || input.meta) return null;
  return input.key === 'ArrowLeft' ? 'back' : input.key === 'ArrowRight' ? 'forward' : null;
}

/** The mouse's back and forward buttons arrive as Windows app commands. */
export function historyActionForCommand(command: string): HistoryAction | null {
  return command === 'browser-backward' ? 'back' : command === 'browser-forward' ? 'forward' : null;
}
