import { useEffect, useState } from 'react';
import type { StackInfo, StackProbeResponse, StackRecommendResponse } from '../../api-types.js';
import { get, post } from '../api.js';

/**
 * Which stack a new project uses (ADR-027). The default is the Incubator's built-in stacks, chosen during
 * discovery. A stack the Incubator does not build in, such as Flutter, is created by its own generator on
 * this computer: the model can recommend one for the idea, and the owner decides.
 */
export function StackChoice(props: {
  idea: string;
  value: string;
  onChange: (stack: string) => void;
  org: string;
  onOrg: (org: string) => void;
  name: string;
  onName: (name: string) => void;
  /** The probe result for the chosen stack, so the wizard can hold back "start" while the tool is missing. */
  onProbe: (probe: StackProbeResponse | null) => void;
}) {
  const { value, onChange, onProbe } = props;
  const [stacks, setStacks] = useState<StackInfo[]>([]);
  const [rec, setRec] = useState<StackRecommendResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const [probe, setProbe] = useState<StackProbeResponse | null>(null);

  useEffect(() => {
    get<StackInfo[]>('/api/stacks')
      .then(setStacks)
      .catch(() => setStacks([]));
  }, []);

  useEffect(() => {
    setProbe(null);
    onProbe(null);
    if (!value) return;
    let live = true;
    post<StackProbeResponse>('/api/stacks/probe', { stack: value })
      .then((p) => {
        if (!live) return;
        setProbe(p);
        onProbe(p);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [value, onProbe]);

  const retrieved = stacks.filter((s) => s.kind === 'retrieved');
  if (retrieved.length === 0) return null;
  const label = (id: string) => stacks.find((s) => s.id === id)?.label ?? id;
  const ask = () => {
    setAsking(true);
    setRec(null);
    // why: the server accepts at most 4000 characters of idea here; an uploaded file can be longer (plan 035).
    post<StackRecommendResponse>('/api/stacks/recommend', { idea: props.idea.slice(0, 4000) })
      .then(setRec)
      .catch((e: Error) => setRec({ status: 'failed', message: e.message }))
      .finally(() => setAsking(false));
  };
  const picked = stacks.find((s) => s.id === value);

  return (
    <div className="stack-choice" data-testid="stack-choice">
      <label>
        Stack
        <select data-testid="stack" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">The Incubator&apos;s built-in stacks (chosen during discovery)</option>
          {retrieved.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}: created with its own tool
            </option>
          ))}
        </select>
      </label>
      <p>
        <button
          type="button"
          className="secondary"
          data-testid="suggest-stack"
          disabled={!props.idea.trim() || asking}
          onClick={ask}
        >
          {asking ? 'Thinking…' : 'Suggest a stack for my idea'}
        </button>
      </p>
      {rec?.status === 'failed' && (
        <p className="muted" data-testid="stack-rec-failed">
          Couldn&apos;t get a suggestion ({rec.message}). Pick a stack from the list.
        </p>
      )}
      {rec?.status === 'ready' && (
        <div className="card" data-testid="stack-rec">
          <strong>Suggested: {label(rec.recommendation.stack)}</strong>
          <ul>
            {rec.recommendation.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {rec.recommendation.alternatives.length > 0 && (
            <>
              <div className="muted">Other options</div>
              <ul>
                {rec.recommendation.alternatives.map((a) => (
                  <li key={a.stack}>
                    {label(a.stack)}: {a.tradeoff}
                  </li>
                ))}
              </ul>
            </>
          )}
          <button
            type="button"
            data-testid="use-suggested"
            onClick={() =>
              onChange(
                retrieved.some((s) => s.id === rec.recommendation.stack)
                  ? rec.recommendation.stack
                  : '',
              )
            }
          >
            {retrieved.some((s) => s.id === rec.recommendation.stack)
              ? `Use ${label(rec.recommendation.stack)}`
              : 'Use the built-in stacks'}
          </button>
        </div>
      )}
      {picked && picked.kind === 'retrieved' && (
        <div data-testid="stack-details">
          <p className="muted">
            The Incubator creates the project in your folder with {picked.label}&apos;s own tool,
            then plans and codes your idea on top of it like any update. It never installs the tool
            for you.
          </p>
          {probe?.ok === true && (
            <p className="muted" data-testid="stack-ready">
              Found {probe.tool}: {probe.version}
            </p>
          )}
          {probe?.ok === false && (
            <p className="warn" data-testid="stack-missing">
              {probe.reason === 'missing'
                ? `${probe.tool} isn't installed (or isn't on this computer's PATH). Install it, then come back: `
                : `${probe.tool} did not run${probe.detail ? ` (${probe.detail})` : ''}. Install or repair it: `}
              <a href={probe.install} target="_blank" rel="noreferrer">
                {probe.install}
              </a>
            </p>
          )}
          <label>
            Project name
            <input
              data-testid="stack-name"
              value={props.name}
              onChange={(e) => props.onName(e.target.value)}
            />
          </label>
          <label>
            Organization identifier (reverse domain)
            <input
              data-testid="stack-org"
              value={props.org}
              onChange={(e) => props.onOrg(e.target.value.trim())}
              placeholder="com.example"
            />
          </label>
        </div>
      )}
    </div>
  );
}
