import { useState } from 'react';
import type { FinishInfo } from '../../api-types.js';

const VERDICT: Record<
  NonNullable<FinishInfo['agent']>['verdict'],
  { text: string; warn: boolean }
> = {
  ready: { text: 'The agent finished and reports the work ready for test.', warn: false },
  parked: {
    text: 'The agent stopped before reaching ready for test. Review with care.',
    warn: true,
  },
  ceiling: {
    text: 'The agent was stopped at a run limit, so the work may be incomplete.',
    warn: true,
  },
  failed: { text: 'The agent exited with an error, so the work may be incomplete.', warn: true },
  stopped: { text: 'You stopped the agent, so the work is probably incomplete.', warn: true },
};

/** The commit request: what changed, what the agent said, and a message for the owner to approve. */
export function CommitRequest({
  finish,
  onCommit,
  onLeave,
}: {
  finish: FinishInfo;
  onCommit: (message: string) => Promise<unknown>;
  onLeave: () => Promise<unknown>;
}) {
  const [message, setMessage] = useState(finish.message);
  const [sending, setSending] = useState(false);
  const run = (p: Promise<unknown>) => {
    setSending(true);
    void p.finally(() => setSending(false));
  };
  const v = finish.agent ? VERDICT[finish.agent.verdict] : null;
  return (
    <section className="card wide" data-testid="commit-request">
      <h2>Review the changes, then commit</h2>
      {v && (
        <p className={v.warn ? 'warn' : 'muted'} data-testid="agent-verdict">
          {v.text}
          {finish.agent?.tripped ? ` (${finish.agent.tripped})` : ''}
        </p>
      )}
      {finish.agent?.checks?.mode === 'approved' && (
        <p className="muted" data-testid="agent-checks">
          The agent could run only the commands you approved (
          {finish.agent.checks.commands.join(', ')}). Whether they passed is its own report: read it
          below.
        </p>
      )}
      {finish.agent?.checks?.mode === 'none' && (
        <p className="warn" data-testid="agent-checks">
          No check commands were approved, so the agent could not run anything. This work is
          untested: run the repository's tests yourself before you commit.
        </p>
      )}
      {finish.agent?.summary && (
        <>
          <h3>What the agent reported</h3>
          <blockquote data-testid="agent-summary">{finish.agent.summary}</blockquote>
        </>
      )}
      <h3>
        Changed files <span className="muted">({finish.files.length})</span>
      </h3>
      <ul className="changes" data-testid="changed-files">
        {finish.files.map((f) => (
          <li key={f.path}>
            <span className="badge">{statusWord(f.code)}</span> {f.path}
          </li>
        ))}
      </ul>
      <label>
        Commit message
        <textarea
          data-testid="commit-message"
          rows={8}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      {finish.identity ? (
        <p className="muted" data-testid="commit-identity">
          Committing on <code>{finish.branch}</code> as {finish.identity.name} &lt;
          {finish.identity.email}&gt;.
        </p>
      ) : (
        <p className="warn" data-testid="commit-identity">
          Git does not know who you are yet. Run{' '}
          <code>git config user.name &quot;Your Name&quot;</code> and{' '}
          <code>git config user.email you@example.com</code> in that folder, then commit.
        </p>
      )}
      <div className="actions">
        <button
          data-testid="commit"
          disabled={sending || !message.trim()}
          onClick={() => run(onCommit(message))}
        >
          Commit these changes
        </button>
        <button
          data-testid="leave"
          className="secondary"
          disabled={sending}
          onClick={() => run(onLeave())}
        >
          Leave them uncommitted
        </button>
      </div>
    </section>
  );
}

/** The push request: send the branch to GitHub as a pull request, or keep it local. */
export function PushRequest({
  finish,
  onPush,
  onSkip,
}: {
  finish: FinishInfo;
  onPush: () => Promise<unknown>;
  onSkip: () => Promise<unknown>;
}) {
  const [sending, setSending] = useState(false);
  const run = (p: Promise<unknown>) => {
    setSending(true);
    void p.finally(() => setSending(false));
  };
  const repo = finish.target.repo;
  return (
    <section className="card wide" data-testid="push-request">
      <h2>Committed. Push it?</h2>
      <p>
        Branch <code>{finish.branch}</code> has your commit
        {finish.commit?.sha ? (
          <>
            {' '}
            (<code>{finish.commit.sha.slice(0, 10)}</code>)
          </>
        ) : null}
        . Pushing sends it to{' '}
        {repo ? (
          <code>
            {repo.owner}/{repo.name}
          </code>
        ) : (
          'GitHub'
        )}{' '}
        and opens a pull request; your other branches are not touched.
      </p>
      <div className="actions">
        <button data-testid="push" disabled={sending} onClick={() => run(onPush())}>
          Push and open a pull request
        </button>
        <button
          data-testid="skip-push"
          className="secondary"
          disabled={sending}
          onClick={() => run(onSkip())}
        >
          Not now, keep it local
        </button>
      </div>
    </section>
  );
}

function statusWord(code: string): string {
  const c = code.trim();
  if (code === '??') return 'new';
  if (c.startsWith('A')) return 'added';
  if (c.startsWith('D')) return 'deleted';
  if (c.startsWith('R')) return 'renamed';
  return 'modified';
}
