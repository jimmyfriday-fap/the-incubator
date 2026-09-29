import { useEffect, useState } from 'react';
import { getSession } from './api.js';
import { navigate } from './nav.js';
import { Home } from './views/Home.js';
import { RunView } from './views/RunView.js';

const runPath = /^\/runs\/([A-Za-z0-9-]+)$/;

export function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [version, setVersion] = useState('');
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    getSession()
      .then((s) => setVersion(s.version))
      .catch(() => setVersion('session expired: reopen the link from `incubator ui`'));
    return () => window.removeEventListener('popstate', on);
  }, []);
  const m = runPath.exec(path);
  return (
    <div className="app">
      <header className="top">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          The Incubator
        </a>
        <span className="muted">{version}</span>
      </header>
      <main>{m ? <RunView runId={m[1]!} key={m[1]} /> : <Home />}</main>
    </div>
  );
}
