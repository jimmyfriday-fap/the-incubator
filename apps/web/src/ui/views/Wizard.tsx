import { useCallback, useEffect, useRef, useState } from 'react';
import type { FolderCheck, StartRunBody } from '../../api-types.js';
import { getSession } from '../api.js';
import { FolderField } from './FolderField.js';

type Intent = '' | 'new' | 'update';

/**
 * The first screen: "What would you like to do", then the steps of that path. Both paths begin with a
 * folder on this computer; the paths themselves (discovery, scan, review, coding) are the existing ones.
 */
export function Wizard({ start }: { start: (body: StartRunBody) => Promise<void> }) {
  const [intent, setIntent] = useState<Intent>('');
  const [canBrowse, setCanBrowse] = useState(false);
  const [folder, setFolder] = useState('');
  const [check, setCheck] = useState<FolderCheck | null>(null);
  const [narrative, setNarrative] = useState('');
  const [repoRef, setRepoRef] = useState('');
  const [gaps, setGaps] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    getSession()
      .then((s) => setCanBrowse(s.capabilities.pickFolder))
      .catch(() => setCanBrowse(false));
  }, []);

  const choose = (next: Intent) => {
    setIntent(next);
    // why: a folder that suits a new solution (empty) never suits an update (a repository), and back.
    setFolder('');
    setCheck(null);
  };
  // The last repository this form filled in itself; a value the owner typed is never overwritten.
  const suggestedRef = useRef('');
  const onCheck = useCallback((c: FolderCheck | null) => {
    setCheck(c);
    const s = c?.git?.suggested;
    const next = s ? `${s.ref.owner}/${s.ref.name}` : '';
    setRepoRef((cur) => (cur === '' || cur === suggestedRef.current ? next : cur));
    suggestedRef.current = next;
  }, []);
  const go = (body: StartRunBody) => {
    setStarting(true);
    void start(body).finally(() => setStarting(false));
  };
  const usable = check?.ok === true;
  const needsRef = intent === 'update' && usable && check?.git?.origin === null;

  return (
    <section className="card wide wizard" data-testid="wizard">
      <label className="wizard-intent">
        What would you like to do
        <select
          data-testid="intent"
          value={intent}
          onChange={(e) => choose(e.target.value as Intent)}
        >
          <option value="" disabled>
            Choose…
          </option>
          <option value="new">New solution</option>
          <option value="update">Update an existing solution</option>
        </select>
      </label>

      {intent === 'new' && (
        <div data-testid="path-new">
          <p className="muted">
            Choose the folder where you want to initialize the new repository. It must be empty, or
            not exist yet: the Incubator creates the project right there.
          </p>
          <FolderField
            purpose="new"
            label="Folder for the new repository"
            canBrowse={canBrowse}
            value={folder}
            onChange={setFolder}
            onCheck={onCheck}
          />
          <label>
            Describe your solution
            <textarea
              data-testid="narrative"
              rows={6}
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              placeholder="Stockroom: a web app for independent cafés to track stock…"
            />
          </label>
          <button
            data-testid="start-new"
            disabled={!usable || !narrative.trim() || starting}
            onClick={() => go({ kind: 'new', narrative, dir: check!.path })}
          >
            Start discovery
          </button>
        </div>
      )}

      {intent === 'update' && (
        <div data-testid="path-update">
          <p className="muted">
            Browse to a folder that has a local repository in it. The Incubator scans it, asks what
            you want to change, and a coding agent makes the changes there on a new branch. Your
            current branch is not touched, and you decide on the commit and the push at the end.
          </p>
          <FolderField
            purpose="existing"
            label="Folder that contains your local repository"
            canBrowse={canBrowse}
            value={folder}
            onChange={setFolder}
            onCheck={onCheck}
          />
          {needsRef && (
            <label>
              GitHub repository for the push and pull request (owner/name), optional
              <input
                data-testid="repo-ref"
                value={repoRef}
                onChange={(e) => setRepoRef(e.target.value)}
                placeholder="octo/my-app"
              />
            </label>
          )}
          <label className="inline">
            <input
              data-testid="enhance-gaps"
              type="checkbox"
              checked={gaps}
              onChange={(e) => setGaps(e.target.checked)}
            />{' '}
            also add the missing canonical-pattern files (as a separate commit)
          </label>
          <div className="actions">
            <button
              data-testid="start-enhance"
              disabled={!usable || starting}
              onClick={() =>
                go({
                  kind: 'enhance',
                  dir: check!.path,
                  ...(repoRef.trim() ? { repoRef: repoRef.trim() } : {}),
                  ...(gaps ? { withGaps: true } : {}),
                })
              }
            >
              Analyze and update
            </button>
            <button
              data-testid="start-adopt"
              className="secondary"
              disabled={!usable || starting}
              onClick={() =>
                go({
                  kind: 'adopt',
                  repo: check!.path,
                  ...(repoRef.trim() ? { repoRef: repoRef.trim() } : {}),
                })
              }
            >
              Only add the missing canonical-pattern files
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
