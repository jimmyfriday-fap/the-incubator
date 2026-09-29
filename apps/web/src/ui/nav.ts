/** Client-side navigation (the server serves the app shell for every extension-less path). */
export function navigate(to: string): void {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
