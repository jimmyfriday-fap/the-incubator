import { useEffect, useRef, useState } from 'react';
import type { FolderCheck, FolderPurpose } from '../../api-types.js';
import { post } from '../api.js';

/**
 * A folder the owner picks with the native dialog (Browse), or types or pastes. Whichever way it got
 * here, the server explains it: what is wrong with it, or what is notable about it.
 */
export function FolderField(props: {
  purpose: FolderPurpose;
  label: string;
  canBrowse: boolean;
  value: string;
  onChange(value: string): void;
  /** The server's verdict on the current value (null while it is being checked or empty). */
  onCheck: (check: FolderCheck | null) => void;
}) {
  const [check, setCheck] = useState<FolderCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [again, setAgain] = useState(0);
  const latest = useRef(0);
  const { purpose, value, onCheck } = props;

  useEffect(() => {
    const mine = ++latest.current;
    setCheck(null);
    onCheck(null);
    if (!value.trim()) return;
    // why: a typed path is checked once the owner pauses, not on every keystroke.
    const timer = window.setTimeout(() => {
      post<FolderCheck>('/api/folders/inspect', { path: value, purpose })
        .then((c) => {
          if (latest.current !== mine) return;
          setCheck(c);
          onCheck(c);
        })
        .catch((e: Error) => {
          if (latest.current === mine) setError(e.message);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [value, purpose, onCheck, again]);

  const browse = () => {
    setBrowsing(true);
    setError(null);
    post<{ path: string | null }>('/api/folders/pick', { purpose })
      .then((r) => {
        if (r.path) props.onChange(r.path);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBrowsing(false));
  };

  return (
    <div className="folder-field">
      <label>
        {props.label}
        <span className="folder-row">
          <input
            data-testid="folder-path"
            value={value}
            onChange={(e) => props.onChange(e.target.value)}
            placeholder={props.canBrowse ? 'Choose a folder…' : 'Paste the full folder path'}
            spellCheck={false}
          />
          {props.canBrowse && (
            <button
              type="button"
              className="secondary"
              data-testid="pick-folder"
              disabled={browsing}
              onClick={browse}
            >
              {browsing ? 'Waiting for the dialog…' : 'Browse…'}
            </button>
          )}
        </span>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {check && (
        <div data-testid="folder-verdict">
          {check.problems.map((p) => (
            <p key={p} className="error" role="alert">
              {p}
            </p>
          ))}
          {check.warnings.map((w) => (
            <p key={w} className="warn">
              {w}
            </p>
          ))}
          {check.ok && purpose === 'new' && (
            <p className="muted" data-testid="folder-ok">
              {check.exists
                ? 'This empty folder will become the repository.'
                : 'This folder will be created and become the repository.'}
            </p>
          )}
          {check.ok && check.git && (
            <p className="muted" data-testid="folder-ok">
              On branch <code>{check.git.branch}</code>, working tree clean
              {check.git.origin ? (
                <>
                  , GitHub <code>{`${check.git.origin.owner}/${check.git.origin.name}`}</code>
                </>
              ) : null}
              . The update will happen on a new branch.
            </p>
          )}
          <button
            type="button"
            className="link"
            data-testid="folder-recheck"
            onClick={() => setAgain((n) => n + 1)}
          >
            Check again
          </button>
        </div>
      )}
    </div>
  );
}
