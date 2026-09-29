import { useEffect, useState } from 'react';
import type { RunListItem, StartRunBody } from '../../api-types.js';
import { get, post } from '../api.js';
import { navigate } from '../nav.js';

/** Intake: a narrative for a new project, or a repository to adopt; plus recent runs. */
export function Home() {
  const [narrative, setNarrative] = useState('');
  const [repo, setRepo] = useState('');
  const [repoRef, setRepoRef] = useState('');
  const [org, setOrg] = useState(false);
  const [local, setLocal] = useState(false);
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
      <section className="card">
        <h2>New project</h2>
        <p className="muted">
          Describe the idea in plain English. You will answer a few questions next.
        </p>
        <textarea
          data-testid="narrative"
          rows={6}
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          placeholder="Stockroom: a web app for independent cafés to track stock…"
        />
        <button
          data-testid="start-new"
          disabled={!narrative.trim()}
          onClick={() => void start({ kind: 'new', narrative })}
        >
          Start discovery
        </button>
      </section>

      <section className="card">
        <h2>Adopt a repository</h2>
        <p className="muted">
          A GitHub URL or a local path. Nothing in it is modified: missing files arrive as a pull
          request.
        </p>
        <label>
          Repository
          <input data-testid="adopt-repo" value={repo} onChange={(e) => setRepo(e.target.value)} />
        </label>
        <label>
          GitHub repository for the pull request (owner/name, when the source is not a GitHub URL)
          <input
            data-testid="adopt-ref"
            value={repoRef}
            onChange={(e) => setRepoRef(e.target.value)}
          />
        </label>
        <label className="inline">
          <input type="checkbox" checked={org} onChange={(e) => setOrg(e.target.checked)} /> the
          owner is an organization
        </label>
        <label className="inline">
          <input
            data-testid="adopt-local"
            type="checkbox"
            checked={local}
            onChange={(e) => setLocal(e.target.checked)}
          />{' '}
          only write the branch locally (no push, no pull request)
        </label>
        <button
          data-testid="start-adopt"
          disabled={!repo.trim()}
          onClick={() =>
            void start({
              kind: 'adopt',
              repo,
              ...(repoRef.trim() ? { repoRef: repoRef.trim() } : {}),
              ...(org ? { org } : {}),
              ...(local ? { noPublish: true } : {}),
            })
          }
        >
          Analyze repository
        </button>
      </section>

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
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
