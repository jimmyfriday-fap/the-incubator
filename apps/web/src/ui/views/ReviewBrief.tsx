import { useEffect, useState } from 'react';
import type { ReviewSummaryResponse } from '../../api-types.js';
import { get } from '../api.js';

/**
 * The plain-English brief above the spec: what this run will do and how. The model writes it from the
 * drafted plan (advisory, never decides anything); until it arrives, or if it fails, the rest of the
 * review works unchanged.
 */
export function ReviewBrief(props: {
  runId: string;
  /** The spec revision the brief is for: a new plan (after corrections) asks for its own brief. */
  rev?: number;
  /** The owner has edited the spec in the editor, so the brief describes the drafted plan only. */
  edited: boolean;
}) {
  const [res, setRes] = useState<ReviewSummaryResponse | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (retry: boolean) => {
      get<ReviewSummaryResponse>(
        `/api/runs/${props.runId}/review-summary${retry ? '?retry=1' : ''}`,
      )
        .then((r) => {
          if (!live) return;
          setRes(r);
          if (r.status === 'pending') timer = setTimeout(() => load(false), 2000);
        })
        .catch((e: Error) => live && setRes({ status: 'failed', message: e.message }));
    };
    setRes(null);
    load(attempt > 0);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [props.runId, props.rev, attempt]);

  if (res?.status === 'unavailable') return null;
  return (
    <section className="card wide brief" data-testid="review-brief">
      <h2>What this run will do</h2>
      {(res === null || res.status === 'pending') && (
        <p className="muted" data-testid="brief-pending">
          Writing a plain-English summary of the plan…
        </p>
      )}
      {res?.status === 'failed' && (
        <p className="muted" data-testid="brief-failed">
          Couldn&apos;t write a summary ({res.message}). The plan below is still complete.{' '}
          <button onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </p>
      )}
      {res?.status === 'ready' && (
        <>
          <p className="brief-headline" data-testid="brief-headline">
            {res.summary.headline}
          </p>
          <h3>What changes</h3>
          <ul data-testid="brief-changes">
            {res.summary.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <h3>How it will be done</h3>
          <p data-testid="brief-approach">{res.summary.approach}</p>
          {res.summary.notIncluded.length > 0 && (
            <>
              <h3>Not included</h3>
              <ul>
                {res.summary.notIncluded.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          )}
          {res.summary.watchFor.length > 0 && (
            <>
              <h3>Worth checking</h3>
              <ul>
                {res.summary.watchFor.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          )}
          <p className="muted">
            Written by a model from the plan below. It is a reading aid: the plan and your approval
            are what count.
            {props.edited && ' You have edited the spec; this summary does not include your edits.'}
          </p>
        </>
      )}
    </section>
  );
}
