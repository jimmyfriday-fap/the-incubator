import type { ReactNode } from 'react';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  /** Something on this tab needs the owner now: the label shows a dot. */
  attention?: boolean;
}

/** A row of tabs (plan 024). The panels stay mounted and are only hidden, so nothing is lost on a switch. */
export function Tabs<T extends string>(props: {
  name: string;
  label: string;
  tabs: readonly TabDef<T>[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="tabbar" role="tablist" aria-label={props.label}>
      {props.tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${props.name}-${t.id}`}
          data-testid={`${props.name}-${t.id}`}
          aria-selected={props.active === t.id}
          aria-controls={`${props.name}-panel-${t.id}`}
          className={props.active === t.id ? 'tabbtn on' : 'tabbtn'}
          onClick={() => props.onSelect(t.id)}
        >
          {t.label}
          {t.attention && <span className="dot" title="Needs you" />}
        </button>
      ))}
    </div>
  );
}

/** One tab's content; hidden (not removed) while another tab is active. */
export function TabPanel(props: { name: string; id: string; active: string; children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      className="tabpanel"
      id={`${props.name}-panel-${props.id}`}
      aria-labelledby={`${props.name}-${props.id}`}
      data-testid={`${props.name}-panel-${props.id}`}
      hidden={props.active !== props.id}
    >
      {props.children}
    </div>
  );
}
