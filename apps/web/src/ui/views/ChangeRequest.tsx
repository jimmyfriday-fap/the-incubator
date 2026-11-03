import { useState, type ChangeEvent } from 'react';
import type { RunDetail } from '../../api-types.js';
import { NARRATIVE_MAX, addMarkdownFiles } from '../markdownFiles.js';

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
  // why: after a refresh (plan 025) the run hands back what the owner asked before, to confirm or edit.
  const previous = (run.parked?.evidence as { previous?: unknown } | null | undefined)?.previous;
  const [text, setText] = useState(typeof previous === 'string' ? previous : '');
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const report = run.enhance?.scanReport ?? null;
  const coverage = report?.split('\n')[0] ?? null;
  // The same markdown upload as describing a new solution (plan 035): the files' text is added to the text box.
  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const files = Array.from(input.files ?? []);
    // why: clear the chooser so the same file can be chosen again after the owner edits the text.
    input.value = '';
    if (files.length === 0) return;
    void addMarkdownFiles(text, files)
      .then((r) => {
        if (r.ok) {
          setText(r.text);
          setAdded((cur) => [...cur, ...r.added]);
          setUploadError(null);
        } else {
          setUploadError(r.error);
        }
      })
      .catch((err: unknown) => {
        setUploadError(err instanceof Error ? err.message : 'The file could not be read.');
      });
  };
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
      {typeof previous === 'string' && (
        <p data-testid="request-previous-note">
          The repository was read again. Below is what you asked before, with any corrections you
          gave at review: confirm it, or edit it.
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
      <label>
        Or add markdown files (.md) to the description
        <input
          data-testid="request-files"
          type="file"
          accept=".md,.markdown,text/markdown"
          multiple
          onChange={onFiles}
        />
      </label>
      <p className="muted" data-testid="request-count">
        {text.length} of {NARRATIVE_MAX} characters
      </p>
      {added.length > 0 && (
        <p className="muted" data-testid="request-added">
          Added to the description: {added.join(', ')}. You can edit the text above.
        </p>
      )}
      {uploadError && (
        <p className="error" role="alert" data-testid="request-upload-error">
          {uploadError}
        </p>
      )}
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
