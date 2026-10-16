import type { WhatNow } from '../../api-types.js';

/** Text with `inline code` spans (the run and install steps carry them): odd pieces between backticks are code. */
function Inline({ text }: { text: string }) {
  return (
    <>{text.split('`').map((piece, i) => (i % 2 === 1 ? <code key={i}>{piece}</code> : piece))}</>
  );
}

/** Plan 057: the operator's guide at the end of a run, the same content as WHAT-NOW.md in the repository. */
export function WhatNowPanel({ w }: { w: WhatNow }) {
  return (
    <section className="what-now" data-testid="what-now">
      <h3>{w.title}</h3>
      <h4>What this is</h4>
      <ul>
        {w.about.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <h4>How to run it</h4>
      <ol data-testid="what-now-run">
        {w.run.map((line) => (
          <li key={line}>
            <Inline text={line} />
          </li>
        ))}
      </ol>
      <h4>How to put it into use</h4>
      <ul>
        {w.install.map((line) => (
          <li key={line}>
            <Inline text={line} />
          </li>
        ))}
      </ul>
      {w.built.length > 0 && (
        <>
          <h4>What was built</h4>
          <ul className="what-now-built">
            {w.built.map((t) => (
              <li key={t.id}>
                <span className={`badge ${t.ready ? 'ready' : 'waiting'}`}>{t.state}</span>{' '}
                <code>{t.id}</code> {t.title}
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>Where it stands</h4>
      <ul>
        {w.status.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <h4>What to do next</h4>
      <ol>
        {w.next.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <p className="muted">
        The same guide is in <code>WHAT-NOW.md</code> at the root of the repository.
      </p>
    </section>
  );
}
