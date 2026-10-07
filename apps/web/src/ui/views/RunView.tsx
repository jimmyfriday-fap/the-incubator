import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry, RepoStatus, RunDetail } from '../../api-types.js';
import { get, post } from '../api.js';
import { ChangeRequest } from './ChangeRequest.js';
import { Coding } from './Coding.js';
import { CommitRequest, PushRequest } from './FinishChanges.js';
import { Crumbs, ProjectBanner } from './Projects.js';
import { ModelsUsed } from './ModelsUsed.js';
import { Questions } from './Questions.js';
import { RepoMoved } from './RepoMoved.js';
import { Review } from './Review.js';
import { RunLog } from './RunLog.js';
import { Summary } from './Summary.js';
import { TabPanel, Tabs } from './Tabs.js';
import { Tree } from './Tree.js';

type RunTab = 'overview' | 'plan' | 'files' | 'log';

/** One run: the header, then tabs for what needs you, the plan, the files and the log (plan 024). */
export function RunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<number | null>(null);
  const [stopping, setStopping] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [tab, setTab] = useState<RunTab>('overview');
  const [repo, setRepo] = useState<RepoStatus | null>(null);
  // why: the owner may commit in their editor while this page is open; ask again when they come back (plan 029).
  const [looked, setLooked] = useState(0);
  useEffect(() => {
    const again = () => setLooked((n) => n + 1);
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);

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

  // The stop has taken effect once the run is no longer working.
  useEffect(() => {
    if (run && !run.busy) setStopping(false);
  }, [run]);

  // The tab follows the run (plan 024): Plan while the plan waits for review, Overview at every other step. A
  // tab the owner picks stays until the run moves on to another step.
  const step: string | null = !run
    ? null
    : run.busy
      ? 'working'
      : [run.state, run.parked?.state ?? '', run.parked?.reason ?? '', run.done ? 'done' : ''].join(
          ':',
        );
  useEffect(() => {
    const follow: RunTab = step?.startsWith('PARKED:REVIEW:') ? 'plan' : 'overview';
    if (step) setTab(follow);
  }, [step]);

  // Whether the repository moved on since the run read it (plan 028): asked again each time the run settles.
  const watchRepo = run?.kind === 'enhance' && !run.done && !run.busy;
  useEffect(() => {
    if (!watchRepo) {
      setRepo(null);
      return;
    }
    // why: an answer that lands after the run moved on (or after a newer ask) must not bring the banner back.
    let live = true;
    get<RepoStatus>(`/api/runs/${runId}/repo-status`)
      .then((s) => {
        if (live) setRepo(s);
      })
      .catch(() => {
        if (live) setRepo(null);
      });
    return () => {
      live = false;
    };
  }, [runId, watchRepo, step, looked]);

  if (!run) return <p className={error ? 'error' : 'muted'}>{error ?? 'Loading…'}</p>;
  const reviewing = run.state === 'PARKED' && run.parked?.state === 'REVIEW' && !run.busy;
  const asking = run.state === 'PARKED' && run.parked?.reason === 'needs_input' && !run.busy;
  const requesting = run.state === 'PARKED' && run.parked?.reason === 'needs_request' && !run.busy;
  const committing = run.state === 'PARKED' && run.parked?.reason === 'needs_commit' && !run.busy;
  const pushing = run.state === 'PARKED' && run.parked?.reason === 'needs_push' && !run.busy;
  const coding = run.busy && (run.state === 'CODE' || run.finish?.stage === 'coding');
  // why: a run parked because its repository moved on (plan 025) is refreshed, not resumed; the banner says so.
  const movedAway = run.state === 'PARKED' && run.parked?.reason === 'repo_moved' && !!repo?.moved;
  const stuck =
    run.state === 'PARKED' &&
    !movedAway &&
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
  // why: after a refresh (plan 025) the request is asked again; until then the banner shows the earlier one.
  const earlier = (run.parked?.evidence as { previous?: unknown } | null | undefined)?.previous;
  const enhanceRequest = run.enhance?.request
    ? run.enhance.request
    : typeof earlier === 'string'
      ? earlier
      : '';

  return (
    <div className="run">
      <Crumbs
        items={[
          run.project ? { label: 'Projects', to: '/projects' } : { label: 'Runs', to: '/runs' },
          ...(run.project ? [{ label: run.project.name, to: `/projects/${run.project.id}` }] : []),
          { label: `Run ${runId}` },
        ]}
      />
      {run.project && (
        <ProjectBanner
          project={run.project}
          request={run.kind === 'enhance' ? enhanceRequest : (run.input.narrative ?? '')}
        />
      )}
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
          <span
            data-testid="run-state"
            className={`badge state-${(run.cancelled ? 'cancelled' : run.state).toLowerCase()}`}
          >
            {run.cancelled ? 'CANCELLED' : run.state}
          </span>{' '}
          {run.busy && (
            <span className="muted" data-testid="busy">
              working…
            </span>
          )}
        </h2>
        {(run.busy || !run.done) && (
          <div className="actions" data-testid="run-controls">
            {run.busy && (
              <button
                className="secondary"
                data-testid="stop"
                disabled={stopping}
                title="Stop what is running now. You can resume the run afterwards."
                onClick={() => {
                  setStopping(true);
                  void act(post(`/api/runs/${runId}/stop`));
                }}
              >
                {stopping ? 'Stopping…' : 'Stop'}
              </button>
            )}
            {!run.done && !confirming && (
              <button
                className="secondary"
                data-testid="cancel-run"
                onClick={() => setConfirming(true)}
              >
                Cancel run
              </button>
            )}
          </div>
        )}
        {confirming && !run.done && (
          <div className="parked" data-testid="cancel-confirm-box">
            <p>
              Cancel this run for good? It stops now and can’t be resumed. Nothing is deleted: any
              files the coding agent already changed in your folder stay as they are.
            </p>
            <button
              data-testid="cancel-confirm"
              onClick={() => {
                setConfirming(false);
                void act(post(`/api/runs/${runId}/cancel`));
              }}
            >
              Yes, cancel this run
            </button>{' '}
            <button
              className="secondary"
              data-testid="cancel-keep"
              onClick={() => setConfirming(false)}
            >
              Keep it
            </button>
          </div>
        )}
        {run.cancelled && (
          <p className="muted" data-testid="cancelled">
            This run was cancelled. Nothing was deleted: files the coding agent already changed in
            your folder are still there.
          </p>
        )}
        <p className="muted">
          {run.input.dir ??
            (run.kind === 'adopt' || run.kind === 'enhance' ? run.input.repo : run.input.narrative)}
        </p>
        <ModelsUsed models={run.models} />
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
        {repo?.moved && (
          <RepoMoved status={repo} onRefresh={() => act(post(`/api/runs/${runId}/refresh`))} />
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
              {run.stopped ? (
                <>
                  {run.stopped.by === 'owner'
                    ? 'You stopped this'
                    : run.stopped.by === 'shutdown'
                      ? 'The app was closed while this was working, so it stopped'
                      : 'This was interrupted'}{' '}
                  at <strong>{run.stopped.state}</strong>. Resume to run that step again; nothing
                  already done is repeated.
                </>
              ) : (
                <>
                  Stopped at <strong>{run.failure?.state ?? run.state}</strong>
                  {run.failure
                    ? '. Fix the cause above, then resume to retry from there.'
                    : ". It isn't running; resume to continue from there."}
                </>
              )}
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

      <Tabs
        name="runtab"
        label="Run sections"
        active={tab}
        onSelect={setTab}
        tabs={[
          {
            id: 'overview',
            label: 'Overview',
            attention: committing || pushing || requesting || asking || stuck || stopped,
          },
          { id: 'plan', label: 'Plan', attention: reviewing },
          { id: 'files', label: 'Files' },
          { id: 'log', label: 'Log' },
        ]}
      />
      <TabPanel name="runtab" id="overview" active={tab}>
        {coding && <Coding run={run} />}
        {reviewing && (
          <p className="muted" data-testid="overview-review-note">
            The plan is ready for your review in the Plan tab.
          </p>
        )}
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
            carried={run.carriedQuestions}
            onSubmit={(answers) => act(post(`/api/runs/${runId}/answers`, { answers }))}
          />
        )}
        {run.done && !run.cancelled && <Summary run={run} />}
      </TabPanel>
      <TabPanel name="runtab" id="plan" active={tab}>
        {!reviewing && (
          <p className="muted" data-testid="plan-note">
            The plan is shown here while it waits for your review.
          </p>
        )}
        {reviewing && (
          <Review
            key={run.rev}
            runId={runId}
            rev={run.rev}
            {...(run.kind === 'new' || run.kind === 'enhance'
              ? {
                  onRequestChanges: (text: string) =>
                    post(`/api/runs/${runId}/changes`, { text }).then(refresh),
                }
              : {})}
            onApprove={(spec) =>
              post(`/api/runs/${runId}/approve`, spec ? { spec } : {}).then(refresh)
            }
            checks={run.enhance?.checks ?? null}
            stack={run.enhance?.stack ?? null}
            onChecks={(commands) => post(`/api/runs/${runId}/checks`, { commands })}
          />
        )}
      </TabPanel>
      <TabPanel name="runtab" id="files" active={tab}>
        {run.specComplete ? (
          <Tree runId={runId} rev={run.rev} />
        ) : (
          <p className="muted" data-testid="files-note">
            The files appear here once the plan is complete.
          </p>
        )}
      </TabPanel>
      <TabPanel name="runtab" id="log" active={tab}>
        <RunLog entries={entries} />
      </TabPanel>
    </div>
  );
}
