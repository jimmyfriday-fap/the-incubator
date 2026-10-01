import type { RunDetail } from '../../api-types.js';

/** The outcome of a finished run: the published repository, or the adopt pull request. */
export function Summary({ run }: { run: RunDetail }) {
  return (
    <section className="card wide" data-testid="summary">
      <h2>Done</h2>
      {run.publish && (
        <>
          <p>
            Published{' '}
            <a data-testid="repo-link" href={run.publish.repo} target="_blank" rel="noreferrer">
              {run.publish.repo}
            </a>{' '}
            at <code>{run.publish.commit.slice(0, 12)}</code>
          </p>
          {run.publish.secretsToSet.length > 0 && (
            <>
              <h3>Set these secrets before deploying</h3>
              <ul>
                {run.publish.secretsToSet.map((s) => (
                  <li key={`${s.repo}:${s.name}`}>
                    <code>{s.name}</code> <span className="muted">{s.description}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {run.publish.warnings.map((w) => (
            <p key={w} className="warn">
              {w}
            </p>
          ))}
          <p className="muted">
            Next: <code>incubator handoff {run.runId} --launch</code>
          </p>
        </>
      )}
      {run.adopt && (
        <>
          {run.adopt.compliant && (
            <p data-testid="compliant">Already compliant: nothing to change, no pull request.</p>
          )}
          {run.adopt.pr && (
            <p>
              Opened pull request{' '}
              <a data-testid="pr-link" href={run.adopt.pr.url} target="_blank" rel="noreferrer">
                #{run.adopt.pr.number}
              </a>
            </p>
          )}
          {run.adopt.report && (
            <details>
              <summary>Gap report</summary>
              <pre data-testid="gap-report">{run.adopt.report}</pre>
            </details>
          )}
        </>
      )}
      {run.finish && (
        <>
          {run.finish.commit?.none && (
            <p data-testid="nothing-changed">
              The agent changed nothing, so there is nothing to commit.
            </p>
          )}
          {run.finish.commit?.left && (
            <p data-testid="left-uncommitted">
              The changes are left uncommitted in <code>{run.finish.dir}</code>
              {run.finish.branch ? (
                <>
                  {' '}
                  on branch <code>{run.finish.branch}</code>
                </>
              ) : null}
              .
            </p>
          )}
          {run.finish.commit?.sha && (
            <p data-testid="committed">
              Committed <code>{run.finish.commit.sha.slice(0, 10)}</code> on{' '}
              <code>{run.finish.commit.branch}</code> in <code>{run.finish.dir}</code>
              {run.finish.pr ? '' : ' (kept local, not pushed)'}.
            </p>
          )}
          {run.finish.pr && (
            <p>
              Pushed, and opened pull request{' '}
              <a
                data-testid="finish-pr-link"
                href={run.finish.pr.url}
                target="_blank"
                rel="noreferrer"
              >
                #{run.finish.pr.number}
              </a>
            </p>
          )}
        </>
      )}
      {run.enhance && (
        <>
          {run.enhance.noop && (
            <p data-testid="noop">
              Nothing to change
              {run.enhance.noop === 'no_features'
                ? ': the request produced no enhancement.'
                : ': this plan is already in the repository.'}{' '}
              No branch, no pull request.
            </p>
          )}
          {run.enhance.pr && (
            <p>
              Opened pull request{' '}
              <a data-testid="pr-link" href={run.enhance.pr.url} target="_blank" rel="noreferrer">
                #{run.enhance.pr.number}
              </a>
            </p>
          )}
          {run.enhance.plan && (
            <>
              {!run.enhance.pr && (
                <p data-testid="local-branch">Enhance branch written locally (no pull request).</p>
              )}
              <p>
                Plan <code data-testid="plan-path">{run.enhance.plan.planPath}</code>:{' '}
                {run.enhance.plan.features.length} request(s), {run.enhance.plan.create.length}{' '}
                file(s) added, {run.enhance.plan.proposed.length} proposed.
              </p>
              <ul data-testid="requests">
                {run.enhance.plan.features.map((f) => (
                  <li key={f.id}>
                    <code>{f.id}</code> <span className="muted">{f.lane}</span>
                    {f.targets.length > 0 && (
                      <span className="muted"> → {f.targets.join(', ')}</span>
                    )}
                  </li>
                ))}
              </ul>
              {run.enhance.plan.gaps && (
                <p className="muted">
                  Canonical-pattern gaps ride in a separate commit you can drop.
                </p>
              )}
              <p className="muted">
                Next: <code>incubator handoff {run.runId} --launch</code>
              </p>
            </>
          )}
          {run.enhance.scanReport && (
            <details>
              <summary>Scan report</summary>
              <pre data-testid="scan-report-final">{run.enhance.scanReport}</pre>
            </details>
          )}
        </>
      )}
    </section>
  );
}
