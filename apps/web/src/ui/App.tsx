import { useEffect, useState } from 'react';
import { getSession } from './api.js';
import { areaOf, historyState, navigate, type Area } from './nav.js';
import { THEME_LABEL, applyTheme, nextTheme, readTheme, type Theme } from './theme.js';
import { Home } from './views/Home.js';
import { Icon, Logo, type IconName } from './views/Icon.js';
import { ProjectView } from './views/ProjectView.js';
import { ProjectsPage } from './views/Projects.js';
import { RunView } from './views/RunView.js';
import { Runs } from './views/Runs.js';
import { Settings } from './views/Settings.js';

const runPath = /^\/runs\/([A-Za-z0-9-]+)$/;
const projectPath = /^\/projects\/([A-Za-z0-9-]+)$/;

const TABS: { area: Area; label: string; to: string; icon: IconName }[] = [
  { area: 'home', label: 'Home', to: '/', icon: 'home' },
  { area: 'projects', label: 'Projects', to: '/projects', icon: 'folder' },
  { area: 'runs', label: 'Runs', to: '/runs', icon: 'list' },
  { area: 'settings', label: 'Settings', to: '/settings', icon: 'gear' },
];

export function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [version, setVersion] = useState('');
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    getSession()
      .then((s) => setVersion(s.version))
      .catch(() => setVersion('session expired: reopen the link from `incubator ui`'));
    return () => window.removeEventListener('popstate', on);
  }, []);
  const m = runPath.exec(path);
  const p = projectPath.exec(path);
  const area = areaOf(path);
  // why: read on every render; a navigation always changes `path`, which re-renders the header.
  const { canBack, canForward } = historyState();
  return (
    <>
      <header className="topbar">
        <div className="top">
          <div className="history" role="group" aria-label="History">
            <button
              className="icon"
              data-testid="nav-back"
              aria-label="Back"
              title="Back"
              disabled={!canBack}
              onClick={() => window.history.back()}
            >
              <Icon name="back" />
            </button>
            <button
              className="icon"
              data-testid="nav-forward"
              aria-label="Forward"
              title="Forward"
              disabled={!canForward}
              onClick={() => window.history.forward()}
            >
              <Icon name="forward" />
            </button>
          </div>
          <a
            href="/"
            className="brand"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            <Logo className="brand-mark" />
            The Incubator
          </a>
          <nav className="tabs" aria-label="Sections">
            {TABS.map((t) => (
              <a
                key={t.area}
                href={t.to}
                data-testid={`tab-${t.area}`}
                aria-current={area === t.area ? 'page' : undefined}
                className={area === t.area ? 'tab on' : 'tab'}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(t.to);
                }}
              >
                <Icon name={t.icon} />
                {t.label}
              </a>
            ))}
          </nav>
          <span className="version">{version}</span>
          <button
            className="icon"
            data-testid="theme-toggle"
            data-theme-choice={theme}
            aria-label={`Theme: ${THEME_LABEL[theme]}`}
            title={`Theme: ${THEME_LABEL[theme]}. Click for ${THEME_LABEL[nextTheme(theme)]}.`}
            onClick={() => {
              const t = nextTheme(theme);
              applyTheme(t);
              setTheme(t);
            }}
          >
            <Icon name={theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor'} />
          </button>
        </div>
      </header>
      <main className="app">
        {m ? (
          <RunView runId={m[1]!} key={m[1]} />
        ) : p ? (
          <ProjectView id={p[1]!} key={p[1]} />
        ) : path === '/projects' ? (
          <ProjectsPage />
        ) : path === '/runs' ? (
          <Runs />
        ) : path === '/settings' ? (
          <Settings />
        ) : (
          <Home />
        )}
      </main>
    </>
  );
}
