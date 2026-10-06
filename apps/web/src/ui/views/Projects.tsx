import { useEffect, useState } from 'react';
import type { ProjectBrief, ProjectCard } from '../../api-types.js';
import { get } from '../api.js';
import { navigate } from '../nav.js';

export const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
};

const open = (id: string) => (e: { preventDefault: () => void }) => {
  e.preventDefault();
  navigate(`/projects/${id}`);
};

/** Where a project lives: its GitHub address when it has one, else the folder on this computer. */
export const whereIs = (p: Pick<ProjectBrief, 'repo'>): string | null =>
  p.repo.url?.replace(/^https:\/\/github\.com\//, '') ?? p.repo.dir;

/** Where you are: a trail of links ending at the current page. */
export function Crumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav className="crumbs muted" aria-label="Breadcrumb" data-testid="crumbs">
      {items.map((c, i) => (
        <span key={`${i}-${c.label}`}>
          {i > 0 && ' › '}
          {c.to ? (
            <a
              href={c.to}
              onClick={(e) => {
                e.preventDefault();
                navigate(c.to!);
              }}
            >
              {c.label}
            </a>
          ) : (
            c.label
          )}
        </span>
      ))}
    </nav>
  );
}

/** The portfolio on the dashboard home: one card per project, newest activity first. */
export function ProjectGrid({ projects }: { projects: ProjectCard[] }) {
  return (
    <ul className="projects" data-testid="projects">
      {projects.map((p) => (
        <li key={p.id}>
          <a
            className="project-card"
            data-testid={`project-${p.id}`}
            href={`/projects/${p.id}`}
            onClick={open(p.id)}
          >
            <strong>{p.name}</strong>
            {p.stack && <span className="badge">{p.stack}</span>}
            <span className="project-summary">{p.summary || 'No summary yet.'}</span>
            {whereIs(p) && <span className="muted project-where">{whereIs(p)}</span>}
            <span className="muted">
              {p.runCount} {p.runCount === 1 ? 'run' : 'runs'}
              {p.latest && (
                <>
                  {' · latest '}
                  <span className={`badge state-${p.latest.state.toLowerCase()}`}>
                    {p.latest.state}
                  </span>{' '}
                  {when(p.latest.startedAt)}
                </>
              )}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The Projects tab: the whole portfolio. */
export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectCard[] | null>(null);
  useEffect(() => {
    get<ProjectCard[]>('/api/portfolio')
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);
  if (projects === null) return <p className="muted">Loading…</p>;
  return (
    <section className="card wide" data-testid="projects-page">
      <h2>Projects</h2>
      {projects.length === 0 ? (
        <p className="muted">
          No projects yet. Start a run from Home and the project appears here.
        </p>
      ) : (
        <ProjectGrid projects={projects} />
      )}
    </section>
  );
}

/** The top of a run page: the project this run is part of, and what this run was asked to do. */
export function ProjectBanner({ project, request }: { project: ProjectBrief; request: string }) {
  return (
    <section className="card wide project-banner" data-testid="project-banner">
      <p className="muted">Project</p>
      <h2>
        <a href={`/projects/${project.id}`} onClick={open(project.id)}>
          {project.name}
        </a>{' '}
        {project.stack && <span className="badge">{project.stack}</span>}
      </h2>
      {project.summary && <p>{project.summary}</p>}
      <p className="muted">
        {whereIs(project) ?? 'No repository yet'} · {project.runCount}{' '}
        {project.runCount === 1 ? 'run' : 'runs'} so far
      </p>
      {request.trim() && (
        <p data-testid="project-request">
          <strong>This run:</strong> {request}
        </p>
      )}
    </section>
  );
}
