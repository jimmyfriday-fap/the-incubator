import { useState } from 'react';
import type { MemoryInfo } from '../../api-types.js';

/**
 * An Add memory run (plan 071): the agent at work, then the playbook's report (the review artifact, shown in
 * full), the rules the Incubator checked, and the push decision.
 */
export function MemoryRun({
  memory,
  busy,
  onManifest,
  onPush,
  onSkip,
}: {
  memory: MemoryInfo;
  busy: boolean;
  onManifest: (yaml: string) => Promise<unknown>;
  onPush: () => Promise<unknown>;
  onSkip: () => Promise<unknown>;
}) {
  const [sending, setSending] = useState(false);
  const [manifest, setManifest] = useState(memory.store?.proposed ?? '');
  const [manifestError, setManifestError] = useState<string | null>(null);
  const send = (p: Promise<unknown>) => {
    setSending(true);
    void p.finally(() => setSending(false));
  };
  const p = memory.progress;
  const repo = memory.target.repo;
  return (
    <section className="card wide" data-testid="memory-run">
      <h2>Add memory: {memory.system}</h2>
      <p className="muted">
        Seed {memory.seedVersion ?? '…'} · <code>{memory.dir}</code>
        {memory.policy && (
          <> · {memory.policy === 'pr' ? 'pull request policy' : 'direct-commit policy'}</>
        )}
        {memory.branch && (
          <>
            {' '}
            · branch <code>{memory.branch}</code>
          </>
        )}
      </p>
      {memory.store?.awaitingManifest && (
        <div className="actions" data-testid="memory-manifest">
          <h3>Confirm the system manifest</h3>
          <p>
            The discovery looked at the repositories and proposed this <code>system.yaml</code>. It
            decides which repositories share one memory store, so read it and edit it if it is
            wrong. Nothing has been written, and nothing is written until you confirm.
          </p>
          <textarea
            data-testid="memory-manifest-text"
            rows={14}
            value={manifest}
            onChange={(e) => setManifest(e.target.value)}
          />
          {memory.store.evidence && (
            <details>
              <summary>The evidence</summary>
              <pre className="memory-report">{memory.store.evidence}</pre>
            </details>
          )}
          {manifestError && (
            <p className="error" role="alert">
              {manifestError}
            </p>
          )}
          <button
            data-testid="confirm-manifest"
            disabled={sending || !manifest.trim()}
            onClick={() => {
              setManifestError(null);
              setSending(true);
              void onManifest(manifest)
                .catch((e: Error) => setManifestError(e.message))
                .finally(() => setSending(false));
            }}
          >
            Confirm the manifest and install
          </button>
        </div>
      )}
      {memory.store && !memory.store.awaitingManifest && memory.store.confirmed && (
        <p className="muted" data-testid="memory-store-line">
          Shared store <code>{memory.store.storeDir ?? ''}</code> for{' '}
          {memory.store.members.join(', ')}
          {memory.store.remote ? '' : '; it has no remote, so it stays on this computer'}.
        </p>
      )}
      {memory.stage === 'running' && (
        <p className="muted" data-testid="memory-progress">
          {busy ? 'The agent is installing memory. ' : ''}
          {p
            ? `${p.turns} step${p.turns === 1 ? '' : 's'}, ${p.toolCalls} tool call${p.toolCalls === 1 ? '' : 's'}${p.costUsd !== null ? `, about $${p.costUsd.toFixed(2)}` : ''}`
            : 'Starting the agent…'}
          {p?.snippet ? ` · ${p.snippet}` : ''}
        </p>
      )}
      {memory.effortApplied === false && (
        <p className="warn">
          The agent CLI has no effort setting, so the chosen effort was not applied.
        </p>
      )}
      {memory.problems.length > 0 && (
        <div className="parked" data-testid="memory-problems">
          <p>The Incubator found broken rules, so nothing is pushed:</p>
          <ul>
            {memory.problems.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {memory.verificationPassed === false && memory.problems.length === 0 && (
        <p className="error" data-testid="memory-verify-failed">
          The playbook&apos;s verification did not all pass. Read the report below.
        </p>
      )}
      {memory.dropped.length > 0 && (
        <p data-testid="memory-dropped">
          Isolation terms dropped because this repository uses them:{' '}
          {memory.dropped.map((t, i) => (
            <span key={t}>
              {i > 0 ? ', ' : ''}
              <code>{t}</code>
            </span>
          ))}
        </p>
      )}
      {memory.report && (
        <>
          <h3>The playbook&apos;s report</h3>
          <pre className="memory-report" data-testid="memory-report">
            {memory.report}
          </pre>
        </>
      )}
      {memory.stage === 'push' && repo && !busy && (
        <div className="actions" data-testid="memory-push">
          <p>
            The install is committed on <code>{memory.branch}</code>. Pushing sends it to{' '}
            <code>
              {repo.owner}/{repo.name}
            </code>
            {memory.policy === 'pr' ? ' and opens a pull request for you to review' : ''}. The
            Incubator never merges.
          </p>
          <button data-testid="push" disabled={sending} onClick={() => send(onPush())}>
            {memory.policy === 'pr' ? 'Push and open a pull request' : 'Push'}
          </button>
          <button
            data-testid="skip-push"
            className="secondary"
            disabled={sending}
            onClick={() => send(onSkip())}
          >
            Not now, keep it local
          </button>
        </div>
      )}
      {memory.stage === 'done' && (
        <p data-testid="memory-done">
          {memory.pr ? (
            <>
              Pull request{' '}
              <a href={memory.pr.url} target="_blank" rel="noreferrer">
                #{memory.pr.number}
              </a>{' '}
              is open for your review.
            </>
          ) : memory.pushed ? (
            'Pushed. The report above is the review of what was installed.'
          ) : (
            <>
              Installed locally on <code>{memory.branch}</code>
              {memory.target.reason ? ` (${memory.target.reason})` : ''}. The report above is your
              review of it.
            </>
          )}
        </p>
      )}
    </section>
  );
}
