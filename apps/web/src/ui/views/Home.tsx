import { useEffect, useState } from 'react';
import type { RunListItem, StartRunBody } from '../../api-types.js';
import { get, post } from '../api.js';
import { navigate } from '../nav.js';
import { Wizard } from './Wizard.js';

/** The first screen: the wizard, then recent runs. */
export function Home() {
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);

  useEffect(() => {
    get<RunListItem[]>('/api/runs')
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);

  const start = async (body: StartRunBody) => {
    setError(null);
    try {
      const { runId } = await post<{ runId: string }>('/api/runs', body);
      navigate(`/runs/${runId}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="home">
      <Wizard start={start} />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="card wide">
        <h2>Recent runs</h2>
        {runs.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : (
          <ul className="runs" data-testid="runs">
            {runs.map((r) => (
              <li key={r.runId}>
                <a
                  href={`/runs/${r.runId}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/runs/${r.runId}`);
                  }}
                >
                  <code>{r.runId}</code>
                </a>{' '}
                <span className={`badge state-${r.state.toLowerCase()}`}>{r.state}</span>{' '}
                <span className="muted">
                  {r.kind} · {r.title}
                </span>
                {r.done && r.repo && (r.kind === 'adopt' || r.kind === 'enhance') && (
                  <>
                    {' '}
                    <button
                      className="link"
                      data-testid={`enhance-${r.runId}`}
                      onClick={() =>
                        void start({
                          kind: 'enhance',
                          // A folder run is updated in place again; any other source keeps its old form.
                          ...(r.dir ? { dir: r.dir } : { repo: r.repo! }),
                          ...(r.repoRef ? { repoRef: r.repoRef } : {}),
                        })
                      }
                    >
                      Update again
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
