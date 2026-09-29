import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry, RunDetail } from '../../api-types.js';
import { get, post } from '../api.js';
import { Questions } from './Questions.js';
import { Review } from './Review.js';
import { RunLog } from './RunLog.js';
import { Summary } from './Summary.js';
import { Tree } from './Tree.js';

/** One run: the step that needs you (questions, review, resume), the outcome, the tree and the log. */
export function RunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<number | null>(null);

  const refresh = useCallback(() => {
    get<RunDetail>(`/api/runs/${runId}`)
      .then((r) => {
        setRun(r);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [runId]);

  // why: journal entries arrive in bursts; coalesce the detail refetch.
  const soon = useCallback(() => {
    if (pending.current !== null) return;
    pending.current = window.setTimeout(() => {
      pending.current = null;
      refresh();
    }, 50);
  }, [refresh]);

  useEffect(() => {
    refresh();
    const es = new EventSource(`/api/runs/${runId}/events`);
    es.addEventListener('entry', (ev) => {
      const e = JSON.parse((ev as MessageEvent<string>).data) as LogEntry;
      setEntries((xs) => (xs.some((x) => x.seq === e.seq) ? xs : [...xs, e]));
      soon();
    });
    es.addEventListener('status', soon);
    return () => {
      es.close();
      if (pending.current !== null) window.clearTimeout(pending.current);
    };
  }, [runId, refresh, soon]);

  if (!run) return <p className={error ? 'error' : 'muted'}>{error ?? 'Loading…'}</p>;
  const reviewing = run.state === 'PARKED' && run.parked?.state === 'REVIEW' && !run.busy;
  const asking = run.state === 'PARKED' && run.parked?.reason === 'needs_input' && !run.busy;
  const stuck = run.state === 'PARKED' && !reviewing && !asking && !run.busy;
  const act = (p: Promise<unknown>) => p.then(refresh).catch((e: Error) => setError(e.message));

  return (
    <div className="run">
      <section className="card wide">
        <h2>
          {run.kind === 'adopt' ? 'Adopt ' : 'New project '}
          <code>{runId}</code>{' '}
          <span data-testid="run-state" className={`badge state-${run.state.toLowerCase()}`}>
            {run.state}
          </span>{' '}
          {run.busy && (
            <span className="muted" data-testid="busy">
              working…
            </span>
          )}
        </h2>
        <p className="muted">{run.kind === 'adopt' ? run.input.repo : run.input.narrative}</p>
        {run.error && (
          <p className="error" role="alert" data-testid="run-error">
            {run.error}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {stuck && run.parked && (
          <div className="parked" data-testid="parked">
            <p>
              Parked at <strong>{run.parked.state}</strong> ({run.parked.reason}):{' '}
              {run.parked.message}
            </p>
            <button
              data-testid="resume"
              onClick={() => void act(post(`/api/runs/${runId}/resume`))}
            >
              Resume
            </button>
          </div>
        )}
      </section>

      {asking && run.questions && (
        <Questions
          questions={run.questions}
          round={run.round}
          onSubmit={(answers) => act(post(`/api/runs/${runId}/answers`, { answers }))}
        />
      )}
      {reviewing && (
        <Review
          runId={runId}
          rev={run.rev}
          onApprove={(spec) =>
            post(`/api/runs/${runId}/approve`, spec ? { spec } : {}).then(refresh)
          }
        />
      )}
      {run.done && <Summary run={run} />}
      {run.specComplete && <Tree runId={runId} rev={run.rev} />}
      <RunLog entries={entries} />
    </div>
  );
}
