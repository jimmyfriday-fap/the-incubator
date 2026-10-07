import { useState } from 'react';
import type { Question } from '../../api-types.js';

const recommended = (q: Question) => (q.options.find((o) => o.recommended) ?? q.options[0])!.value;

/** CLARIFY cards: one per question, the recommended option highlighted and preselected. */
export function Questions(props: {
  questions: Question[];
  round: number;
  /** Earlier answers asked again after a refresh (plan 028): each one's earlier answer is selected. */
  carried?: boolean;
  onSubmit(answers: { key: string; value: string }[]): Promise<unknown>;
}) {
  const [chosen, setChosen] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.questions.map((q) => [q.key, recommended(q)])),
  );
  const [sending, setSending] = useState(false);
  const submit = (answers: Record<string, string>) => {
    setSending(true);
    void props
      .onSubmit(props.questions.map((q) => ({ key: q.key, value: answers[q.key]! })))
      .finally(() => setSending(false));
  };
  return (
    <section className="card wide" data-testid="questions">
      <h2>{props.carried ? 'Your earlier answers' : `A few questions (round ${props.round})`}</h2>
      {props.carried && (
        <p className="muted" data-testid="carried-note">
          The repository was read again. These are the questions you answered before, with your
          answer selected: keep it or pick another.
        </p>
      )}
      {props.questions.map((q) => (
        <fieldset key={q.key} className="question" data-testid={`question-${q.key}`}>
          <legend>{q.question}</legend>
          {q.options.map((o) => (
            <label key={o.value} className={`option${o.recommended ? ' recommended' : ''}`}>
              <input
                type="radio"
                name={q.key}
                value={o.value}
                checked={chosen[q.key] === o.value}
                onChange={() => setChosen((c) => ({ ...c, [q.key]: o.value }))}
              />
              {o.label}
              {o.recommended && (
                <span className="badge">{props.carried ? 'your answer' : 'recommended'}</span>
              )}
            </label>
          ))}
        </fieldset>
      ))}
      <div className="actions">
        <button data-testid="submit-answers" disabled={sending} onClick={() => submit(chosen)}>
          Submit answers
        </button>
        <button
          data-testid="accept-defaults"
          className="secondary"
          disabled={sending}
          onClick={() =>
            submit(Object.fromEntries(props.questions.map((q) => [q.key, recommended(q)])))
          }
        >
          {props.carried ? 'Keep all my answers' : 'Accept all defaults'}
        </button>
      </div>
    </section>
  );
}
