import { useEffect, useState } from 'react';
import type { RunListItem } from '../../api-types.js';
import { get } from '../api.js';
import { navigate } from '../nav.js';

type Filter = 'all' | 'active' | 'waiting' | 'finished' | 'cancelled';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'In progress' },
  { id: 'waiting', label: 'Waiting for you' },
  { id: 'finished', label: 'Finished' },
  { id: 'cancelled', label: 'Cancelled' },
];

/** A run is waiting for the owner when it is parked on a question, a review, a commit or a push. */
export const waiting = (r: RunListItem): boolean =>
  !r.done && r.state === 'PARKED' && (r.parked ?? '').startsWith('needs_');

export const matches = (r: RunListItem, f: Filter): boolean =>
  f === 'all' ||
  (f === 'cancelled' && r.cancelled) ||
  (f === 'finished' && r.done && !r.cancelled) ||
  (f === 'waiting' && waiting(r)) ||
  (f === 'active' && !r.done && !waiting(r));

/** Every run, newest first, with the project it belongs to. */
export function Runs() {
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    get<RunListItem[]>('/api/runs')
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);

  if (runs === null) return <p className="muted">Loading…</p>;
  const shown = runs.filter((r) => matches(r, filter));
  return (
    <section className="card wide" data-testid="runs-page">
      <h2>Runs</h2>
      <div className="filters" role="tablist" aria-label="Filter runs">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            data-testid={`runs-filter-${f.id}`}
            className={filter === f.id ? 'chip on' : 'chip'}
            onClick={() => setFilter(f.id)}
          >
            {f.label} ({runs.filter((r) => matches(r, f.id)).length})
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="muted">No runs here.</p>
      ) : (
        <ul className="runs" data-testid="runs">
          {shown.map((r) => (
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
              <span
                className={`badge state-${(r.cancelled ? 'cancelled' : r.state).toLowerCase()}`}
              >
                {r.cancelled ? 'CANCELLED' : r.state}
              </span>{' '}
              <span className="muted">
                {r.kind} · {r.title}
                {r.project && ` · ${r.project.name}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
