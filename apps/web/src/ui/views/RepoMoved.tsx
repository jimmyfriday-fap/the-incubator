import { useState } from 'react';
import type { RepoStatus } from '../../api-types.js';

/** The repository moved on since the run read it (plan 028): the owner can read it again. */
export function RepoMoved(props: { status: RepoStatus; onRefresh: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const { commits, recorded, current } = props.status;
  const what =
    commits === null
      ? 'it has new commits'
      : commits === 0
        ? 'another branch is checked out'
        : `${commits} new commit${commits === 1 ? '' : 's'}`;
  return (
    <div className="parked" data-testid="repo-moved">
      <p>
        The repository has changed since this run read it: {what}
        {recorded && current && (
          <>
            {' '}
            (<code>{recorded.slice(0, 7)}</code> → <code>{current.slice(0, 7)}</code>)
          </>
        )}
        . Refresh to read it again: you then confirm your request and your earlier answers, and the
        plan is drafted again from the code as it is now.
      </p>
      <button
        data-testid="refresh-repo"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void props.onRefresh().finally(() => setBusy(false));
        }}
      >
        {busy ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
