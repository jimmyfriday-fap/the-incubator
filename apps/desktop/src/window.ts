/** BrowserWindow webPreferences: sandboxed renderer, no Node, no preload bridge. */
export function secureWebPreferences(): {
  sandbox: true;
  contextIsolation: true;
  nodeIntegration: false;
  webSecurity: true;
} {
  return { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true };
}
