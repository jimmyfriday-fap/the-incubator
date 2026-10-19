import { useEffect, useState } from 'react';
import type { AppStatus } from '../../api-types.js';
import { ApiError, get, post } from '../api.js';

/** Plan 064: starts a finished project on this machine, shows each step, and links to it once it answers. */
export function StartAppPanel({ runId }: { runId: string }) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<AppStatus>(`/api/runs/${runId}/app`)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [runId]);

  const act = (what: 'start' | 'stop') => {
    setBusy(true);
    setError(null);
    post<AppStatus>(`/api/runs/${runId}/app/${what}`)
      .then(setStatus)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'The project could not be started.'),
      )
      .finally(() => setBusy(false));
  };

  if (!status?.available) return null;
  const up = status.state === 'up';
  return (
    <section className="start-app" data-testid="start-app">
      <h3>Run it</h3>
      <p className="muted">
        Starts the project on this machine with Docker, step by step. The first start builds images
        and can take several minutes.
      </p>
      <div className="actions">
        <button
          type="button"
          data-testid={up ? 'app-stop' : 'app-start'}
          disabled={busy}
          onClick={() => act(up ? 'stop' : 'start')}
        >
          {busy ? (up ? 'Stopping…' : 'Starting…') : up ? 'Stop' : 'Start the app'}
        </button>
        {up && status.url && (
          <a data-testid="app-open" href={status.url} target="_blank" rel="noreferrer">
            Open {status.url}
          </a>
        )}
      </div>
      {status.state === 'failed' && (
        <p className="warn">It did not come up. The last step shown below says why.</p>
      )}
      {status.steps.length > 0 && (
        <ul data-testid="app-steps">
          {status.steps.map((s, i) => (
            <li key={`${s.title}-${i}`}>
              {s.ok ? '✔' : '✖'} {s.title}
              {!s.ok && s.tail && <pre>{s.tail}</pre>}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="warn">{error}</p>}
    </section>
  );
}
