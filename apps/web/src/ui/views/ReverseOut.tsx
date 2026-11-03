import { useState } from 'react';
import { get, post } from '../api.js';
import { navigate } from '../nav.js';

interface Plan {
  allowed: boolean;
  refusal?: { code: string; message: string };
  actions: (
    | { kind: 'remove-worktree'; repo: string; dir: string; dirtyCount: number }
    | { kind: 'delete-branch'; dir: string; branch: string; returnTo: string | null }
    | { kind: 'remove-run-folder'; dir: string }
  )[];
  leftBehind: { what: string; url?: string }[];
  needsConfirm: boolean;
}
interface Done {
  removed: string[];
  leftBehind: { what: string; url?: string }[];
}

let notice: Done | null = null;
/** What the last reverse-out did, shown once on the Runs list the owner lands on afterwards. */
export function takeReverseNotice(): Done | null {
  const n = notice;
  notice = null;
  return n;
}

const describe = (a: Plan['actions'][number]): string =>
  a.kind === 'remove-worktree'
    ? `Remove the worktree ${a.dir}${a.dirtyCount ? ` (it has ${a.dirtyCount} uncommitted file(s), which will be lost)` : ''}`
    : a.kind === 'delete-branch'
      ? `Delete the branch ${a.branch} in ${a.dir}${a.returnTo ? `, going back to ${a.returnTo} first` : ''}`
      : 'Delete the run and its working copy from the Incubator’s data folder';

/** Undoes a run that did not finish: shows what would go and what would stay, then does it. */
export function ReverseOut({ runId }: { runId: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);

  const look = () => {
    setError(null);
    get<Plan>(`/api/runs/${runId}/reverse-out`)
      .then(setPlan)
      .catch((e: Error) => setError(e.message));
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      notice = await post<Done>(`/api/runs/${runId}/reverse-out`, {
        ...(sure ? { confirmDirtyWorktree: true } : {}),
      });
      navigate('/runs');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!plan)
    return (
      <>
        <button className="secondary" data-testid="reverse-out" onClick={look}>
          Reverse out
        </button>
        {error && <p className="error">{error}</p>}
      </>
    );
  return (
    <div className="parked" data-testid="reverse-out-box">
      {plan.allowed ? (
        <>
          <p>Reverse out of this run? This is what will be removed from this computer:</p>
          <ul className="plain" data-testid="reverse-out-actions">
            {plan.actions.map((a, i) => (
              <li key={i}>{describe(a)}</li>
            ))}
          </ul>
          {plan.leftBehind.length > 0 && (
            <>
              <p>These stay, and you would remove them by hand:</p>
              <ul className="plain" data-testid="reverse-out-left">
                {plan.leftBehind.map((l, i) => (
                  <li key={i}>
                    {l.what}
                    {l.url && (
                      <>
                        {' '}
                        <a href={l.url} target="_blank" rel="noreferrer">
                          {l.url}
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {plan.needsConfirm && (
            <label className="inline">
              <input
                data-testid="reverse-out-sure"
                type="checkbox"
                checked={sure}
                onChange={(e) => setSure(e.target.checked)}
              />{' '}
              I understand the uncommitted files in that worktree will be lost
            </label>
          )}
          <button
            data-testid="reverse-out-confirm"
            disabled={busy || (plan.needsConfirm && !sure)}
            onClick={() => void run()}
          >
            {busy ? 'Removing…' : 'Yes, reverse out'}
          </button>{' '}
        </>
      ) : (
        <p data-testid="reverse-out-refused">{plan.refusal?.message}</p>
      )}
      <button className="secondary" data-testid="reverse-out-keep" onClick={() => setPlan(null)}>
        Keep it
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
