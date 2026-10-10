import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../../api-types.js';
import { codeLogLine } from '../verify.js';

type Level = 'info' | 'warn' | 'error';

export function levelOf(e: LogEntry): Level {
  if (e.type === 'step.fail' || e.type === 'interrupted') return 'error';
  if (e.type === 'park' || e.type === 'step.warn' || e.type === 'questions.dropped') return 'warn';
  return 'info';
}

function describe(e: LogEntry): string {
  switch (e.type) {
    case 'state.enter':
      return `→ ${String(e['state'])}${e['round'] ? ` (round ${Number(e['round'])})` : ''}`;
    case 'park':
      return `parked: ${String(e['message'])}`;
    case 'step.ok':
    case 'step.warn':
    case 'step.fail':
      return `${e.type.slice(5)} ${String(e['step'])}`;
    case 'spec.revision':
      return `spec revision ${String(e['rev'])}${e['final'] ? ' (complete)' : ''}`;
    case 'llm.turn':
      return `model call (${typeof e['purpose'] === 'string' ? e['purpose'] : 'planning'}): ${String(e['adapter'])}${typeof e['model'] === 'string' ? ` · ${e['model']}` : ''}`;
    case 'handoff.launch':
      return `coding agent started: ${String(e['agent'])}${typeof e['model'] === 'string' ? ` · ${e['model']}` : ''}`;
    case 'handoff.result':
      return `coding agent finished${typeof e['model'] === 'string' ? ` · ${e['model']}` : ''}`;
    case 'review.feedback':
      return `correction at review: ${String(e['text'])}`;
    case 'answers.superseded':
      return `earlier answers replaced by a correction: ${(e['keys'] as string[]).join(', ')}`;
    case 'repo.refresh': {
      const to = typeof e['to'] === 'string' ? ` at ${e['to'].slice(0, 7)}` : '';
      const n = typeof e['commits'] === 'number' ? e['commits'] : 0;
      return `repository read again${to}${n > 0 ? ` (${n} new commit${n === 1 ? '' : 's'})` : ''}`;
    }
    case 'code.part':
    case 'code.baseline':
    case 'code.verify':
      return codeLogLine(e) ?? e.type;
    case 'code.continue':
      return `continue coding from ${String(e['from']).slice(0, 7)} on ${String(e['branch'])}`;
    case 'questions':
      return `${(e['questions'] as unknown[]).length} question(s)${e['carried'] === true ? ', asked again from before the refresh' : ''}`;
    default:
      return e.type;
  }
}

/** The live journal over SSE: auto-scrolls while you are at the bottom, filterable by level. */
export function RunLog({ entries }: { entries: LogEntry[] }) {
  const [level, setLevel] = useState<'all' | Level>('all');
  const box = useRef<HTMLOListElement>(null);
  const shown = entries.filter((e) => level === 'all' || levelOf(e) === level);
  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [shown.length]);
  return (
    <section className="card wide">
      <h2>
        Run log{' '}
        <select
          data-testid="log-filter"
          value={level}
          onChange={(e) => setLevel(e.target.value as 'all' | Level)}
        >
          <option value="all">all</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
      </h2>
      <ol className="log" ref={box} data-testid="run-log">
        {shown.map((e) => (
          <li key={e.seq} className={`level-${levelOf(e)}`}>
            <span className="muted">{e.ts.slice(11, 19)}</span> {describe(e)}
          </li>
        ))}
      </ol>
    </section>
  );
}
