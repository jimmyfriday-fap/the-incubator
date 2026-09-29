import { useEffect, useState } from 'react';
import type { TreeFile } from '../../api-types.js';
import { get } from '../api.js';

const LIMIT = 400;

/** The rendered file tree (from memory, before anything is written), with adopt delta statuses. */
export function Tree({ runId, rev }: { runId: string; rev: number }) {
  const [files, setFiles] = useState<TreeFile[] | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<{ path: string; text: string | null } | null>(null);

  useEffect(() => {
    get<{ files: TreeFile[] }>(`/api/runs/${runId}/tree`)
      .then((t) => setFiles(t.files))
      .catch(() => setFiles(null));
  }, [runId, rev]);

  if (!files) return null;
  const shown = files.filter((f) => f.path.includes(filter));
  return (
    <section className="card wide" data-testid="tree">
      <h2>
        Files <span className="muted">({files.length})</span>
      </h2>
      <input
        placeholder="filter paths"
        data-testid="tree-filter"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="tree-grid">
        <ul className="tree">
          {shown.slice(0, LIMIT).map((f) => (
            <li key={f.path}>
              <button
                className="link"
                onClick={() =>
                  void get<{ path: string; text: string | null }>(
                    `/api/runs/${runId}/file?path=${encodeURIComponent(f.path)}`,
                  )
                    .then(setOpen)
                    .catch(() => setOpen(null))
                }
              >
                {f.path}
              </button>
              {f.status && <span className={`badge status-${f.status}`}>{f.status}</span>}
            </li>
          ))}
          {shown.length > LIMIT && (
            <li className="muted">… {shown.length - LIMIT} more (filter to narrow)</li>
          )}
        </ul>
        {open && (
          <div className="viewer">
            <h3>{open.path}</h3>
            <pre data-testid="file-view">{open.text ?? '(binary file)'}</pre>
          </div>
        )}
      </div>
    </section>
  );
}
