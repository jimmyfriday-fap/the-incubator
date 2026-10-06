import { useEffect, useState } from 'react';
import type { ProjectCard, RunListItem, StartRunBody } from '../../api-types.js';
import { get, post } from '../api.js';
import { navigate } from '../nav.js';
import { ProjectGrid } from './Projects.js';
import { Wizard } from './Wizard.js';

/** The first screen: the wizard, then the portfolio of projects (and the runs, while there is none). */
export function Home() {
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [projects, setProjects] = useState<ProjectCard[] | null>(null);

  useEffect(() => {
    get<ProjectCard[]>('/api/portfolio')
      .then(setProjects)
      .catch(() => setProjects([]));
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

      {projects !== null && projects.length > 0 && (
        <section className="card wide">
          <h2>Your projects</h2>
          <ProjectGrid projects={projects} />
        </section>
      )}

      {projects !== null && projects.length === 0 && (
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
      )}
    </div>
  );
}
