import { useState } from 'react';
import type { RunDetail } from '../../api-types.js';

/**
 * The "What do you want to change?" step of an enhance run: the scan is done, so the owner can see
 * what was (and was not) read, then describes the change in their own words.
 */
export function ChangeRequest({
  run,
  onSubmit,
}: {
  run: RunDetail;
  onSubmit: (text: string) => Promise<unknown>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const report = run.enhance?.scanReport ?? null;
  const coverage = report?.split('\n')[0] ?? null;
  const submit = () => {
    setBusy(true);
    void onSubmit(text).finally(() => setBusy(false));
  };
  return (
    <section className="card wide" data-testid="change-request">
      <h2>What do you want to change?</h2>
      {coverage && (
        <p className="muted" data-testid="scan-coverage">
          {coverage}
        </p>
      )}
      <p className="muted">
        Describe the update in plain English. You will be asked a few questions about it next, then
        review the plan before anything is written. Nothing in the repository is modified.
      </p>
      <textarea
        data-testid="request-text"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Kitchen staff need to export the orders list as a CSV file…"
      />
      <button data-testid="submit-request" disabled={!text.trim() || busy} onClick={submit}>
        Continue
      </button>
      {report && (
        <details>
          <summary>What the scan found</summary>
          <pre data-testid="scan-report">{report}</pre>
        </details>
      )}
    </section>
  );
}
