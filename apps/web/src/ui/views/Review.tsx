import { useEffect, useMemo, useState } from 'react';
import type { Revision, SpecChange } from '../../api-types.js';
import { ApiError, get } from '../api.js';

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
}) {
  const [revs, setRevs] = useState<Revision[]>([]);
  const [from, setFrom] = useState<number | null>(null);
  const [diff, setDiff] = useState<{ changes: SpecChange[]; spec: Record<string, unknown> } | null>(
    null,
  );
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

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
    props
      .onApprove(edited)
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

  return (
    <section className="card wide review" data-testid="review">
      <h2>Review the spec</h2>
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
  );
}
