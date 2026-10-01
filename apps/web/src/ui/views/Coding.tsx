import type { RunDetail } from '../../api-types.js';

/** While the coding agent works in the owner's folder: where, and how far it has got. */
export function Coding({ run }: { run: RunDetail }) {
  const p = run.finish?.progress ?? null;
  return (
    <section className="card wide" data-testid="coding">
      <h2>The coding agent is working</h2>
      <p>
        It is making the changes in <code data-testid="coding-dir">{run.input.dir}</code>
        {run.finish?.branch ? (
          <>
            {' '}
            on branch <code>{run.finish.branch}</code>
          </>
        ) : null}
        . Nothing is committed: when it stops you will see what it changed and decide.
      </p>
      {p ? (
        <p className="muted" data-testid="coding-progress">
          {p.turns} step{p.turns === 1 ? '' : 's'}, {p.toolCalls} tool call
          {p.toolCalls === 1 ? '' : 's'}
          {p.costUsd !== null ? `, about $${p.costUsd.toFixed(2)}` : ''}
          {p.snippet ? <> · {p.snippet}</> : null}
        </p>
      ) : (
        <p className="muted">Starting the agent…</p>
      )}
    </section>
  );
}
