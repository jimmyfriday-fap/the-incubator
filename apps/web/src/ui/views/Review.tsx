import { useEffect, useMemo, useState } from 'react';
import type { Revision, SpecChange } from '../../api-types.js';
import { ApiError, get } from '../api.js';
import { RequestChanges } from './RequestChanges.js';
import { ReviewBrief } from './ReviewBrief.js';

interface Decision {
  key: string;
  question: string;
  answer: string;
  source: string;
}

const show = (v: unknown) => (v === undefined ? '' : JSON.stringify(v));

/**
 * REVIEW: the spec diff grouped by top-level key, the decisions with their source, and an editor. An
 * edited spec is validated by the engine on approval; a rejected edit shows its issues here.
 */
export function Review(props: {
  runId: string;
  rev: number;
  onApprove(spec?: unknown): Promise<unknown>;
  /** Set when the owner decides which commands the coding agent may run (ADR-025). */
  checks?: {
    proposed: { command: string; what: string; why: string }[];
    approved: string[] | null;
  } | null;
  onChecks?(commands: string[]): Promise<unknown>;
  /** The owner's corrections at review (plan 021); absent where the run cannot take them. */
  onRequestChanges?: (text: string) => Promise<unknown>;
  /** What the scan recognised the repository as (update runs). */
  stack?: { label: string; evidence: string[]; packed: boolean } | null;
}) {
  const [revs, setRevs] = useState<Revision[]>([]);
  const [from, setFrom] = useState<number | null>(null);
  const [diff, setDiff] = useState<{ changes: SpecChange[]; spec: Record<string, unknown> } | null>(
    null,
  );
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // One command per line, starting from what was approved before, else from the proposals.
  const [checksText, setChecksText] = useState(() =>
    (props.checks?.approved ?? props.checks?.proposed.map((c) => c.command) ?? []).join('\n'),
  );

  useEffect(() => {
    get<Revision[]>(`/api/runs/${props.runId}/revisions`)
      .then(setRevs)
      .catch(() => setRevs([]));
  }, [props.runId, props.rev]);

  useEffect(() => {
    const q = from === null ? '' : `?from=${from}`;
    get<{ changes: SpecChange[]; spec: Record<string, unknown> }>(
      `/api/runs/${props.runId}/spec-diff${q}`,
    )
      .then((d) => {
        setDiff(d);
        setText((t) => t || `${JSON.stringify(d.spec, null, 2)}\n`);
      })
      .catch((e: Error) => setProblem(e.message));
  }, [props.runId, props.rev, from]);

  const groups = useMemo(() => {
    const m = new Map<string, SpecChange[]>();
    for (const c of diff?.changes ?? []) {
      const top = c.pointer.split('/')[1] ?? '';
      m.set(top, [...(m.get(top) ?? []), c]);
    }
    return [...m];
  }, [diff]);
  const decisions = ((diff?.spec['decisions'] as Decision[] | undefined) ?? []).slice();
  const parsed = useMemo(() => {
    try {
      return JSON.parse(text) as { project?: { owner?: { login?: string; type?: string } } };
    } catch {
      return null;
    }
  }, [text]);
  const owner = parsed?.project?.owner;
  const setOwner = (patch: { login?: string; type?: string }) => {
    if (!parsed?.project) return;
    parsed.project.owner = { ...parsed.project.owner, ...patch };
    setText(`${JSON.stringify(parsed, null, 2)}\n`);
  };

  const approve = () => {
    setProblem(null);
    let edited: unknown;
    const original = diff ? `${JSON.stringify(diff.spec, null, 2)}\n` : '';
    if (text !== original) {
      try {
        edited = JSON.parse(text);
      } catch (e) {
        setProblem(`The spec is not valid JSON: ${(e as Error).message}`);
        return;
      }
    }
    setSending(true);
    const commands = checksText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    // The commands are decided first: a refused list stops the approval.
    (props.checks && props.onChecks ? props.onChecks(commands) : Promise.resolve())
      .then(() => props.onApprove(edited))
      .catch((e: unknown) => {
        const issues =
          e instanceof ApiError
            ? (e.evidence as { issues?: unknown[] } | undefined)?.issues
            : undefined;
        setProblem(
          `${(e as Error).message}${issues ? `\n${issues.map((i) => JSON.stringify(i)).join('\n')}` : ''}`,
        );
      })
      .finally(() => setSending(false));
  };

  const original = diff
    ? `${JSON.stringify(diff.spec, null, 2)}
`
    : '';
  const noPack = (diff?.spec['stack'] as { pack?: string } | undefined)?.pack === 'other';

  return (
    <>
      <ReviewBrief
        runId={props.runId}
        rev={props.rev}
        edited={original !== '' && text !== original}
      />
      {props.onRequestChanges && <RequestChanges onSubmit={props.onRequestChanges} />}
      <section className="card wide review" data-testid="review">
        <h2>Review the spec</h2>
        {noPack && (
          <p className="warn" data-testid="no-pack-note">
            {props.stack ? (
              <>
                <strong>Detected: {props.stack.label}</strong>
                {props.stack.evidence.length > 0 && ` (${props.stack.evidence.join(', ')})`}. The
                Incubator doesn&apos;t have a stack pack for it yet, so it delivers only your change
                requests and leaves out its standard project files. The <code>other</code> values in
                the spec below just mean &ldquo;no pack&rdquo;; they aren&apos;t used.
              </>
            ) : (
              <>
                This repository has no Incubator stack pack. The platform, stack, deploy and testing
                values below say <code>other</code> and are not used: only your change requests are
                delivered, and the canonical-pattern files are left out.
              </>
            )}
          </p>
        )}
        <div className="review-grid">
          <div>
            <label className="inline">
              Compare with revision{' '}
              <select
                data-testid="diff-from"
                value={from ?? ''}
                onChange={(e) => setFrom(e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">previous</option>
                <option value="0">empty</option>
                {revs.slice(0, -1).map((r) => (
                  <option key={r.rev} value={r.rev}>
                    {r.rev}
                    {r.inferred ? ' (inferred)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <div data-testid="spec-diff">
              {groups.length === 0 && <p className="muted">No changes.</p>}
              {groups.map(([top, changes]) => (
                <details key={top} open>
                  <summary>
                    {top} <span className="muted">({changes.length})</span>
                  </summary>
                  <table className="diff">
                    <tbody>
                      {changes.map((c) => (
                        <tr key={c.pointer} className={`op-${c.op}`}>
                          <td>
                            <code>{c.pointer}</code>
                          </td>
                          <td className="before">{show(c.before)}</td>
                          <td className="after">{show(c.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ))}
            </div>
            <div className="owner">
              <label>
                GitHub owner (user or organization the repository is created under)
                <input
                  data-testid="owner-login"
                  value={owner?.login ?? ''}
                  disabled={!parsed?.project}
                  onChange={(e) => setOwner({ login: e.target.value.trim() })}
                />
              </label>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={owner?.type === 'org'}
                  disabled={!parsed?.project}
                  onChange={(e) => setOwner({ type: e.target.checked ? 'org' : 'user' })}
                />{' '}
                organization
              </label>
            </div>
            <h3>incubator.json</h3>
            <textarea
              data-testid="spec-editor"
              className="code"
              rows={18}
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {problem && (
              <pre className="error" role="alert" data-testid="review-error">
                {problem}
              </pre>
            )}
            {props.checks && (
              <div className="checks" data-testid="checks">
                <h3>Checks the coding assistant may run</h3>
                <p className="muted">
                  After the coding assistant edits your code, these are the only commands it is
                  allowed to run to test its own work, plus <code>git status</code> and{' '}
                  <code>git diff</code>. It can&apos;t run anything else. They were suggested from
                  what is in your repository, and they have nothing to do with stack packs. One
                  command per line; edit the list, add your own, or clear it to let the assistant
                  edit files without running anything.
                </p>
                <textarea
                  data-testid="checks-editor"
                  rows={Math.max(3, checksText.split('\n').length + 1)}
                  value={checksText}
                  onChange={(e) => setChecksText(e.target.value)}
                  placeholder="flutter test"
                  spellCheck={false}
                />
                {props.checks.proposed.length > 0 && (
                  <ul className="muted" data-testid="checks-proposed">
                    {props.checks.proposed.map((c) => (
                      <li key={c.command}>
                        <code>{c.command}</code>: {c.what} Suggested because of {c.why}.
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {!owner?.login && <p className="warn">Set the GitHub owner: publishing needs it.</p>}
            <button
              data-testid="approve"
              disabled={sending || !diff || !owner?.login}
              onClick={approve}
            >
              Approve and continue
            </button>
          </div>
          <aside className="decisions" data-testid="decisions">
            <h3>Decisions</h3>
            <ul>
              {decisions.map((d) => (
                <li key={d.key}>
                  <span className={`badge source-${d.source}`}>{d.source}</span>{' '}
                  <strong>{d.key}</strong>
                  <div className="muted">{d.question}</div>
                  <div>{d.answer}</div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>
    </>
  );
}
