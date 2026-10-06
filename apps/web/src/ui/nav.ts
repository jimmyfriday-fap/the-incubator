/** Client-side navigation (the server serves the app shell for every extension-less path). */
export function navigate(to: string): void {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** The part of Chromium's Navigation API the header needs. */
export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

function currentNavigation(): NavigationState | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as { navigation?: NavigationState }).navigation;
}

/**
 * Whether the back and forward buttons have somewhere to go. Chromium (and so Electron) reports it; where
 * it does not, both stay enabled and a press with nowhere to go does nothing.
 */
export function historyState(nav: NavigationState | undefined = currentNavigation()): {
  canBack: boolean;
  canForward: boolean;
} {
  return { canBack: nav?.canGoBack ?? true, canForward: nav?.canGoForward ?? true };
}

export type Area = 'home' | 'projects' | 'runs' | 'settings';

/** Which tab a path belongs to: a run or a project page stays under its own tab. */
export function areaOf(path: string): Area {
  if (path === '/runs' || path.startsWith('/runs/')) return 'runs';
  if (path === '/projects' || path.startsWith('/projects/')) return 'projects';
  if (path === '/settings') return 'settings';
  return 'home';
}
