import { useEffect, useState } from 'react';
import type { ProjectDetail, StartRunBody } from '../../api-types.js';
import { get, post, put } from '../api.js';
import { parseTerms, termsText } from '../memoryForm.js';
import { navigate } from '../nav.js';
import { AddMemory } from './AddMemory.js';
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
  const [adding, setAdding] = useState(false);
  const [ids, setIds] = useState<string | null>(null);

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

  const saveIds = async () => {
    setError(null);
    try {
      const saved = await put<{ identifiers: string[] }>(`/api/portfolio/${id}/identifiers`, {
        identifiers: parseTerms(ids ?? ''),
      });
      setProject({ ...project, identifiers: saved.identifiers });
      setIds(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const memory = project.memory;

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
          <div className="actions">
            <button data-testid="project-update" onClick={() => void update()}>
              Update again
            </button>
            <button
              data-testid="project-add-memory"
              className="secondary"
              disabled={memory !== null}
              title={memory ? 'This solution already has memory' : undefined}
              onClick={() => setAdding(!adding)}
            >
              Add memory
            </button>
          </div>
        )}
        {adding && !memory && project.repo.dir && (
          <AddMemory dir={project.repo.dir} projectId={project.id} />
        )}
      </section>

      <section className="card wide" data-testid="project-memory">
        <h2>Memory</h2>
        {memory ? (
          <>
            <p data-testid="memory-status">
              <span className="badge">{memory.mode} mode</span> system <code>{memory.system}</code>{' '}
              · seed {memory.seedVersion}
              {project.memoryUpgradable ? ' (a newer seed is available)' : ''} · store{' '}
              <code>{memory.store}</code> ·{' '}
              {memory.commitPolicy === 'pr' ? 'pull requests' : 'direct commits'} · installed{' '}
              {memory.installedAt}
            </p>
            <details>
              <summary>The install report</summary>
              <pre className="memory-report">{memory.report}</pre>
            </details>
          </>
        ) : (
          <p className="muted">No memory installed.</p>
        )}
        <h3>Code identifiers</h3>
        <p className="muted">
          This solution&apos;s distinctive code identifiers: function or class prefixes, package or
          plugin slugs, internal endpoint hosts. Other solutions&apos; memory installs keep them
          out. Never brand names, domains or servers.
        </p>
        {ids === null ? (
          <p>
            {project.identifiers.length ? (
              project.identifiers.map((t, i) => (
                <span key={t}>
                  {i > 0 ? ', ' : ''}
                  <code>{t}</code>
                </span>
              ))
            ) : (
              <span className="muted">None yet.</span>
            )}{' '}
            <button
              className="secondary"
              data-testid="identifiers-edit"
              onClick={() => setIds(termsText(project.identifiers))}
            >
              Edit
            </button>
          </p>
        ) : (
          <>
            <textarea
              data-testid="identifiers"
              rows={4}
              value={ids}
              onChange={(e) => setIds(e.target.value)}
            />
            <div className="actions">
              <button data-testid="identifiers-save" onClick={() => void saveIds()}>
                Save
              </button>
              <button className="secondary" onClick={() => setIds(null)}>
                Cancel
              </button>
            </div>
          </>
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
