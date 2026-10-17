import { useState } from 'react';
import type { StandUpGuide } from '../../api-types.js';
import { ApiError, post } from '../api.js';

/**
 * Plan 062: copies text without the async clipboard API, which a locked-down webview or an insecure page refuses:
 * select a hidden text box and ask the document to copy. False when that is refused too.
 */
function copyWithSelection(text: string): boolean {
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'absolute';
  box.style.left = '-9999px';
  document.body.appendChild(box);
  box.select();
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(box);
  return ok;
}

/** Plan 059: writes the stand-up guide of a finished run (plan 058), then shows it with Copy and Download. */
export function StandUpGuidePanel({ runId }: { runId: string }) {
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState<StandUpGuide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const write = () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    post<StandUpGuide>(`/api/runs/${runId}/stand-up-guide`)
      .then(setGuide)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'The guide could not be written.'),
      )
      .finally(() => setBusy(false));
  };

  const download = () => {
    if (!guide) return;
    const url = URL.createObjectURL(new Blob([guide.markdown], { type: 'text/markdown' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = guide.fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copy = () => {
    if (!guide) return;
    const text = guide.markdown;
    const viaApi =
      'clipboard' in navigator
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error('no clipboard api'));
    void viaApi
      .catch(() => {
        if (!copyWithSelection(text)) throw new Error('copy refused');
      })
      .then(() => {
        setError(null);
        setCopied(true);
      })
      .catch(() => setError('The guide could not be copied: use Download instead.'));
  };

  return (
    <section className="stand-up" data-testid="stand-up">
      <h3>Stand-up guide</h3>
      <p className="muted">
        One document of what was built and the exact steps to stand it up, written so a coding
        assistant can follow it. Give it to the assistant in the project folder.
      </p>
      <div className="actions">
        <button type="button" data-testid="stand-up-write" disabled={busy} onClick={write}>
          {busy ? 'Writing…' : guide ? 'Write it again' : 'Write the stand-up guide'}
        </button>
        {guide && (
          <>
            <button type="button" data-testid="stand-up-download" onClick={download}>
              Download {guide.fileName}
            </button>
            <button type="button" data-testid="stand-up-copy" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="error" data-testid="stand-up-error">
          {error}
        </p>
      )}
      {guide && (
        <pre className="stand-up-text" data-testid="stand-up-text">
          {guide.markdown}
        </pre>
      )}
    </section>
  );
}
