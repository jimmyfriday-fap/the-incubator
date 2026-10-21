import { useState } from 'react';
import type { IntakeTicketView } from '../../api-types.js';
import { ApiError, get, post } from '../api.js';
import { navigate } from '../nav.js';
import {
  beginBlocker,
  editsFrom,
  featureIdFor,
  startBody,
  type RequestEdits,
} from '../requests.js';

/**
 * Custom App requests: the owner types the Leantime ticket number, reads what the customer asked for, fixes the
 * narrative and features, confirms the 50% deposit and begins development. The ticket is read again by the
 * server when the run starts, so only the edits made here travel back.
 */
export function Requests() {
  const [number, setNumber] = useState('');
  const [ticket, setTicket] = useState<IntakeTicketView | null>(null);
  const [edits, setEdits] = useState<RequestEdits | null>(null);
  const [deposit, setDeposit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const id = number.trim();
    if (!/^[0-9]{1,9}$/.test(id)) {
      setError('Enter the ticket number (digits only).');
      return;
    }
    setLoading(true);
    setError(null);
    setTicket(null);
    setEdits(null);
    setDeposit(false);
    try {
      const t = await get<IntakeTicketView>(`/api/intake/tickets/${id}`);
      setTicket(t);
      setEdits(editsFrom(t));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The ticket could not be read.');
    } finally {
      setLoading(false);
    }
  };

  const begin = async () => {
    if (!ticket || !edits) return;
    setBusy(true);
    setError(null);
    try {
      const { runId } = await post<{ runId: string }>('/api/runs', startBody(ticket, edits));
      navigate(`/runs/${runId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The build could not be started.');
      setBusy(false);
    }
  };

  const blocker = ticket && edits ? beginBlocker({ depositReceived: deposit, edits, busy }) : null;
  const r = ticket?.request;
  return (
    <div className="run" data-testid="requests-page">
      <section className="card wide">
        <h2>Custom App requests</h2>
        <p className="muted">
          Enter the ticket number from the Custom App request project to see what the customer asked
          for. Nothing starts until you confirm the deposit.
        </p>
        <form
          className="actions"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <label>
            Ticket number
            <input
              data-testid="request-number"
              inputMode="numeric"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="for example 10850"
            />
          </label>
          <button type="submit" data-testid="request-load" disabled={loading || !number.trim()}>
            {loading ? 'Reading…' : 'Read the ticket'}
          </button>
        </form>
        {error && (
          <p className="error" data-testid="request-error">
            {error}
          </p>
        )}
      </section>

      {ticket && edits && r && (
        <>
          <section className="card wide" data-testid="request-summary">
            <h3>
              #{r.leantimeTicketId} {r.headline}
            </h3>
            {r.wpStatus && <p className="muted">WordPress status: {r.wpStatus}</p>}
            <h4>Who</h4>
            <p style={{ whiteSpace: 'pre-wrap' }}>{r.who || '—'}</p>
            <h4>Problem today</h4>
            <p style={{ whiteSpace: 'pre-wrap' }}>{r.problem || '—'}</p>
            <h4>Wanted outcome</h4>
            <p style={{ whiteSpace: 'pre-wrap' }}>{r.outcome || '—'}</p>
            <h4>Contact</h4>
            <p style={{ whiteSpace: 'pre-wrap' }}>{r.contact || '—'}</p>
            {r.openQuestions && (
              <>
                <h4>Open questions</h4>
                <p style={{ whiteSpace: 'pre-wrap' }}>{r.openQuestions}</p>
              </>
            )}
          </section>

          <section className="card wide" data-testid="request-gaps">
            <h3>Gaps</h3>
            {ticket.gaps.length === 0 ? (
              <p className="muted">None: the draft is complete.</p>
            ) : (
              <ul className="plain">
                {ticket.gaps.map((g) => (
                  <li key={g} className="warn">
                    {g}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card wide">
            <h3>Spec draft</h3>
            <p className="muted" data-testid="request-project">
              {ticket.draft.project.name} ({ticket.draft.project.slug})
            </p>
            <label>
              Narrative
              <textarea
                data-testid="request-narrative"
                rows={6}
                maxLength={20000}
                value={edits.narrative}
                onChange={(e) => setEdits({ ...edits, narrative: e.target.value })}
              />
            </label>
            <h4>Features</h4>
            {edits.features.length === 0 && <p className="muted">No features yet.</p>}
            {edits.features.map((f, i) => (
              <div className="actions" key={f.id} data-testid="request-feature">
                <input
                  aria-label={`Feature ${f.id}`}
                  value={f.summary}
                  maxLength={500}
                  onChange={(e) =>
                    setEdits({
                      ...edits,
                      features: edits.features.map((x, j) =>
                        j === i ? { ...x, summary: e.target.value } : x,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove ${f.id}`}
                  onClick={() =>
                    setEdits({ ...edits, features: edits.features.filter((_, j) => j !== i) })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              data-testid="request-add-feature"
              disabled={edits.features.length >= 20}
              onClick={() =>
                setEdits({
                  ...edits,
                  features: [
                    ...edits.features,
                    {
                      id: featureIdFor(
                        'new feature',
                        edits.features.map((f) => f.id),
                      ),
                      summary: 'New feature',
                      lane: 'enhancement/new',
                    },
                  ],
                })
              }
            >
              Add a feature
            </button>
          </section>

          <section className="card wide">
            <label>
              <input
                type="checkbox"
                data-testid="request-deposit"
                checked={deposit}
                onChange={(e) => setDeposit(e.target.checked)}
              />{' '}
              50% deposit received
            </label>
            <p className="muted">
              The build runs with the runbook ceiling: $10, 45 minutes, 150 turns and 400 tool
              calls.
            </p>
            <div className="actions">
              <button
                type="button"
                data-testid="request-begin"
                disabled={blocker !== null}
                title={blocker ?? undefined}
                onClick={() => void begin()}
              >
                {busy ? 'Starting…' : 'Begin development'}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
