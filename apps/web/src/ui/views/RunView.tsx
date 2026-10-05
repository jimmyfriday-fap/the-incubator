import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry, RunDetail } from '../../api-types.js';
import { get, post } from '../api.js';
import { ChangeRequest } from './ChangeRequest.js';
import { Coding } from './Coding.js';
import { CommitRequest, PushRequest } from './FinishChanges.js';
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
  const requesting = run.state === 'PARKED' && run.parked?.reason === 'needs_request' && !run.busy;
  const committing = run.state === 'PARKED' && run.parked?.reason === 'needs_commit' && !run.busy;
  const pushing = run.state === 'PARKED' && run.parked?.reason === 'needs_push' && !run.busy;
  const coding = run.busy && (run.state === 'CODE' || run.finish?.stage === 'coding');
  const stuck =
    run.state === 'PARKED' &&
    !reviewing &&
    !asking &&
    !requesting &&
    !committing &&
    !pushing &&
    !run.busy;
  // why: a run that failed (or was cut off) is neither parked nor working; without this it shows
  // no way forward, and after a restart not even the error.
  const stopped = !run.done && !run.busy && run.state !== 'PARKED';
  const act = (p: Promise<unknown>) => p.then(refresh).catch((e: Error) => setError(e.message));

  return (
    <div className="run">
      <section className="card wide">
        <h2>
          {run.kind === 'adopt'
            ? 'Adopt '
            : run.kind === 'enhance'
              ? 'Update '
              : run.input.dir
                ? 'New solution '
                : 'New project '}
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
        <p className="muted">
          {run.input.dir ??
            (run.kind === 'adopt' || run.kind === 'enhance' ? run.input.repo : run.input.narrative)}
        </p>
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
        {stopped && (
          <div className="parked" data-testid="stopped">
            <p>
              Stopped at <strong>{run.failure?.state ?? run.state}</strong>
              {run.failure
                ? '. Fix the cause above, then resume to retry from there.'
                : ". It isn't running; resume to continue from there."}
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

      {coding && <Coding run={run} />}
      {committing && run.finish && (
        <CommitRequest
          finish={run.finish}
          onCommit={(message) =>
            act(post(`/api/runs/${runId}/commit`, { action: 'commit', message }))
          }
          onLeave={() => act(post(`/api/runs/${runId}/commit`, { action: 'leave' }))}
        />
      )}
      {pushing && run.finish && (
        <PushRequest
          finish={run.finish}
          onPush={() => act(post(`/api/runs/${runId}/push`, { action: 'push' }))}
          onSkip={() => act(post(`/api/runs/${runId}/push`, { action: 'skip' }))}
        />
      )}
      {requesting && (
        <ChangeRequest
          run={run}
          onSubmit={(narrative) => act(post(`/api/runs/${runId}/request`, { narrative }))}
        />
      )}
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
          checks={run.enhance?.checks ?? null}
          stack={run.enhance?.stack ?? null}
          onChecks={(commands) => post(`/api/runs/${runId}/checks`, { commands })}
        />
      )}
      {run.done && <Summary run={run} />}
      {run.specComplete && <Tree runId={runId} rev={run.rev} />}
      <RunLog entries={entries} />
    </div>
  );
}
