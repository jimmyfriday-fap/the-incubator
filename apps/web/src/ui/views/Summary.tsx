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
    </section>
  );
}
