import { useEffect, useState } from 'react';
import type { MemoryChoices, MemoryDefaults, StartRunBody } from '../../api-types.js';
import { get, post } from '../api.js';
import { memoryBody, termsText, validSystem } from '../memoryForm.js';
import { navigate } from '../nav.js';

/**
 * "Add memory" (plan 071): installs agent memory into one repository by running the memory seed's playbook in
 * an agent session. The isolation terms start as every other solution's code identifiers; the owner can edit them.
 */
export function AddMemory({ dir, projectId }: { dir: string; projectId?: string }) {
  const [defaults, setDefaults] = useState<MemoryDefaults | null>(null);
  const [system, setSystem] = useState('');
  const [terms, setTerms] = useState('');
  const [policy, setPolicy] = useState<MemoryChoices['commitPolicy']>('auto');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = projectId
      ? `projectId=${encodeURIComponent(projectId)}`
      : `dir=${encodeURIComponent(dir)}`;
    get<MemoryDefaults>(`/api/memory/defaults?${q}`)
      .then((d) => {
        setDefaults(d);
        setSystem(d.system);
        setTerms(termsText(d.isolationTerms));
        setModel(d.model);
        setEffort(d.effort);
      })
      .catch((e: Error) => setError(e.message));
  }, [dir, projectId]);

  if (!defaults) return <p className={error ? 'error' : 'muted'}>{error ?? 'Loading…'}</p>;

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const body: StartRunBody = {
        kind: 'memory',
        dir,
        memory: memoryBody({ system, terms, policy, model, effort }),
      };
      const { runId } = await post<{ runId: string }>('/api/runs', body);
      navigate(`/runs/${runId}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  };

  return (
    <div className="memory-form" data-testid="memory-form">
      <h3>Add memory</h3>
      <p className="muted">
        A coding agent follows the memory seed (version {defaults.seedVersion}) to install{' '}
        <code>.memory/</code>, its skills, the CLAUDE.md block and the hooks in <code>{dir}</code>.
        It commits the install following the repository&apos;s own commit policy; you then read its
        report and decide the push. AGENTS.md and your application code are never changed, and
        nothing is merged.
      </p>
      <label>
        System name
        <input
          data-testid="memory-system"
          value={system}
          onChange={(e) => setSystem(e.target.value)}
        />
      </label>
      {!validSystem(system) && (
        <p className="error" data-testid="memory-system-error">
          Use lowercase words joined by hyphens, like rolling-schedule.
        </p>
      )}
      <label>
        Isolation terms: other systems&apos; code identifiers to keep out of this memory (one per
        line). Function or class prefixes, package or plugin slugs, internal endpoint hosts; never
        brand names, domains or servers. Terms this repository uses itself are dropped by the
        playbook.
        <textarea
          data-testid="memory-terms"
          rows={5}
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
        />
      </label>
      <label>
        Commit policy
        <select
          data-testid="memory-policy"
          value={policy}
          onChange={(e) => setPolicy(e.target.value as MemoryChoices['commitPolicy'])}
        >
          <option value="auto">Detect it from the repository (recommended)</option>
          <option value="pr">Branch and pull request</option>
          <option value="direct">Commit to the default branch</option>
        </select>
      </label>
      <label>
        Model
        <input
          data-testid="memory-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </label>
      <label>
        Effort
        <select
          data-testid="memory-effort"
          value={effort}
          onChange={(e) => setEffort(e.target.value)}
        >
          {defaults.efforts.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        data-testid="start-memory"
        disabled={starting || !validSystem(system)}
        onClick={() => void start()}
      >
        {starting ? 'Starting…' : 'Install memory'}
      </button>
    </div>
  );
}
