import { useEffect, useState } from 'react';
import type { ProjectDetail, StartRunBody } from '../../api-types.js';
import { get, post } from '../api.js';
import { navigate } from '../nav.js';
import { Crumbs, when, whereIs } from './Projects.js';

const ORIGIN = {
  created: 'created by the Incubator',
  adopted: 'brought into the Incubator conventions',
  existing: 'already existed; first updated with the Incubator',
} as const;

/** One project: what it is, where it lives, and every run that worked on it. */
export function ProjectView({ id }: { id: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<ProjectDetail>(`/api/portfolio/${id}`)
      .then(setProject)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  if (!project) return <p className={error ? 'error' : 'muted'}>{error ?? 'Loading…'}</p>;

  const update = async () => {
    setError(null);
    try {
      const body: StartRunBody = { kind: 'enhance', dir: project.repo.dir! };
      const { runId } = await post<{ runId: string }>('/api/runs', body);
      navigate(`/runs/${runId}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="run" data-testid="project-page">
      <Crumbs items={[{ label: 'Projects', to: '/projects' }, { label: project.name }]} />
      <section className="card wide">
        <h2>
          {project.name} {project.stack && <span className="badge">{project.stack}</span>}
        </h2>
        {project.summary && <p>{project.summary}</p>}
        <p className="muted">
          {whereIs(project) ?? 'No repository yet'}
          {project.repo.dir && project.repo.url ? ` · ${project.repo.dir}` : ''} ·{' '}
          {ORIGIN[project.origin]} · since {when(project.createdAt)}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {project.repo.dir && (
          <button data-testid="project-update" onClick={() => void update()}>
            Update again
          </button>
        )}
      </section>

      <section className="card wide">
        <h2>History</h2>
        {project.runs.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : (
          <ul className="runs" data-testid="project-runs">
            {project.runs.map((r) => (
              <li key={r.runId}>
                {r.available ? (
                  <a
                    href={`/runs/${r.runId}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/runs/${r.runId}`);
                    }}
                  >
                    <code>{r.runId}</code>
                  </a>
                ) : (
                  <code title="this run's folder was removed">{r.runId}</code>
                )}{' '}
                <span className={`badge state-${r.state.toLowerCase()}`}>{r.state}</span>{' '}
                <span className="muted">
                  {r.kind} · {when(r.startedAt)}
                </span>
                {r.request && <div className="run-request">{r.request}</div>}
                {r.outcome && (
                  <div className="muted">
                    {r.outcome.pr && (
                      <a href={r.outcome.pr.url} target="_blank" rel="noreferrer">
                        pull request #{r.outcome.pr.number}
                      </a>
                    )}
                    {r.outcome.commit &&
                      ` committed ${r.outcome.commit.slice(0, 7)}${r.outcome.branch ? ` on ${r.outcome.branch}` : ''}`}
                    {r.outcome.local && ` left in ${r.outcome.local}`}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
