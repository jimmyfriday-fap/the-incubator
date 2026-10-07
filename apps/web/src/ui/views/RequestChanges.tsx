import { useState } from 'react';

/**
 * At REVIEW (plan 021): the owner describes what to add, remove or do differently. The run drafts the plan
 * again with it and comes back here with a new plan and a new "What this run will do".
 */
export function RequestChanges({ onSubmit }: { onSubmit: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = () => {
    setBusy(true);
    setProblem(null);
    onSubmit(text)
      .then(() => setText(''))
      .catch((e: Error) => setProblem(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <section className="card wide request-changes" data-testid="request-changes">
      <h2>Want something changed?</h2>
      <p className="muted">
        Describe what to add, remove or do differently, in your own words. The plan below is drafted
        again with your corrections, and you review it before anything is written.
      </p>
      <textarea
        data-testid="review-changes-text"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Also let coaches filter meets by date, and leave out the export for now…"
      />
      {problem && (
        <p className="error" role="alert" data-testid="review-changes-error">
          {problem}
        </p>
      )}
      <button data-testid="submit-changes" disabled={!text.trim() || busy} onClick={submit}>
        {busy ? 'Sending…' : 'Update the plan'}
      </button>
    </section>
  );
}
