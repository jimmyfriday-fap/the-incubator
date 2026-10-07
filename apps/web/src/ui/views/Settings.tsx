import { useEffect, useState } from 'react';
import type { SettingsPatch, SettingsView } from '../../api-types.js';
import { get, put } from '../api.js';
import { TabPanel, Tabs } from './Tabs.js';

type Section = 'models' | 'limits' | 'accounts';

const MODELS = [
  'opus',
  'sonnet',
  'haiku',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-4-5-20251001',
];
const AGENTS = ['claude', 'copilot', 'cursor'];
// The same rule the server applies: a model id is a plain token (letters, digits and . _ : -).
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

interface Form {
  planningTool: string;
  planningModel: string;
  codingAgent: string;
  codingModel: string;
  timeoutSeconds: string;
  gcDays: string;
  toolPaths: { name: string; path: string }[];
}

const toForm = (v: SettingsView): Form => ({
  planningTool: v.chosen.planning.tool,
  planningModel: v.chosen.planning.model ?? '',
  codingAgent: v.chosen.coding.agent,
  codingModel: v.chosen.coding.model ?? '',
  timeoutSeconds: v.chosen.limits.timeoutSeconds?.toString() ?? '',
  gcDays: v.chosen.limits.gcDays?.toString() ?? '',
  toolPaths: Object.entries(v.chosen.toolPaths).map(([name, path]) => ({ name, path })),
});

const number = (text: string): number | null => (text.trim() === '' ? null : Number(text));

/** The Settings page: which AI plans and which codes, their models, limits and tool locations. */
export function Settings() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState<Section>('models');

  useEffect(() => {
    get<SettingsView>('/api/settings')
      .then((v) => {
        setView(v);
        setForm(toForm(v));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!view || !form) return <p className={error ? 'error' : 'muted'}>{error ?? 'Loading…'}</p>;

  const set = (change: Partial<Form>) => {
    setForm({ ...form, ...change });
    setSaved(false);
  };
  const modelProblem = (m: string) =>
    m.trim() !== '' && !MODEL_ID.test(m.trim()) ? 'Use letters, digits and . _ : - only.' : null;
  const planner = view.adapters.find((a) => a.id === form.planningTool);
  const coder = view.adapters.find((a) => a.id === `${form.codingAgent}-cli`);
  const problem =
    modelProblem(form.planningModel) ??
    modelProblem(form.codingModel) ??
    (form.toolPaths.some(
      (t) => t.name.trim() !== '' && !/^([A-Za-z]:[\\/]|[\\/])/.test(t.path.trim()),
    )
      ? 'A tool location must be a full path.'
      : null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const patch: SettingsPatch = {
      planning: { tool: form.planningTool, model: form.planningModel.trim() || null },
      coding: { agent: form.codingAgent, model: form.codingModel.trim() || null },
      limits: { timeoutSeconds: number(form.timeoutSeconds), gcDays: number(form.gcDays) },
      toolPaths: Object.fromEntries(
        form.toolPaths.filter((t) => t.name.trim()).map((t) => [t.name.trim(), t.path.trim()]),
      ),
    };
    try {
      const next = await put<SettingsView>('/api/settings', patch);
      setView(next);
      setForm(toForm(next));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const e = view.effective;
  return (
    <div className="run" data-testid="settings-page">
      <section className="card wide">
        <h2>Settings</h2>
        <p className="muted">
          A change applies to the next run. A run that is already working keeps what it started
          with.
        </p>
        <h3>In use now</h3>
        <ul className="plain" data-testid="in-use">
          <li data-testid="in-use-planning">
            <strong>Planning</strong> (questions, analysis, summaries):{' '}
            {e.planning.tool ? (
              <>
                {e.planning.tool} · {e.planning.model ?? 'the tool’s own default model'}
              </>
            ) : (
              <span className="error">{e.planning.problem ?? 'no tool can plan'}</span>
            )}
          </li>
          <li data-testid="in-use-coding">
            <strong>Coding</strong> (changes your files): {e.coding.agent} ·{' '}
            {e.coding.model ?? 'the tool’s own default model'}
            {!e.coding.installed && <span className="error"> · not installed</span>}
            {view.chosen.coding.agent === 'auto' && (
              <span className="muted"> · unless the project’s own settings choose another</span>
            )}
          </li>
        </ul>
      </section>

      <Tabs
        name="settingstab"
        label="Settings sections"
        active={section}
        onSelect={setSection}
        tabs={[
          { id: 'models', label: 'AI models' },
          { id: 'limits', label: 'Limits & tools' },
          { id: 'accounts', label: 'Accounts & about' },
        ]}
      />
      <section className="card wide" hidden={section === 'accounts'}>
        <TabPanel name="settingstab" id="models" active={section}>
          <h3>AI for planning</h3>
          <label>
            Tool
            <select
              data-testid="planning-tool"
              value={form.planningTool}
              onChange={(ev) => set({ planningTool: ev.target.value })}
            >
              <option value="auto">Automatic (first one that works)</option>
              {view.adapters.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.canPlan}>
                  {a.id}
                  {a.installed ? (a.version ? ` ${a.version}` : '') : ' (not installed)'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model
            <input
              data-testid="planning-model"
              list="model-suggestions"
              value={form.planningModel}
              placeholder="the tool’s own default"
              onChange={(ev) => set({ planningModel: ev.target.value })}
            />
          </label>
          {modelProblem(form.planningModel) && (
            <p className="error">{modelProblem(form.planningModel)}</p>
          )}
          {planner && !planner.takesModel && form.planningModel.trim() && (
            <p className="warn">{planner.id} cannot be told which model to use; this is ignored.</p>
          )}

          <h3>AI for coding</h3>
          <label>
            Agent
            <select
              data-testid="coding-agent"
              value={form.codingAgent}
              onChange={(ev) => set({ codingAgent: ev.target.value })}
            >
              <option value="auto">Automatic (the project decides, usually claude)</option>
              {AGENTS.map((a) => {
                const info = view.adapters.find((x) => x.id === `${a}-cli`);
                return (
                  <option key={a} value={a} disabled={info ? !info.canCode : false}>
                    {a}
                    {info && !info.installed ? ' (not installed)' : ''}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            Model
            <input
              data-testid="coding-model"
              list="model-suggestions"
              value={form.codingModel}
              placeholder="the tool’s own default"
              onChange={(ev) => set({ codingModel: ev.target.value })}
            />
          </label>
          {modelProblem(form.codingModel) && (
            <p className="error">{modelProblem(form.codingModel)}</p>
          )}
          {coder && !coder.takesModel && form.codingModel.trim() && (
            <p className="warn">
              {coder.id} has no way to choose a model, so a run would stop and ask you to clear
              this.
            </p>
          )}
          <datalist id="model-suggestions">
            {MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <p className="muted">
            Leave a model empty to use the tool’s own default. The run page shows which model each
            job really used.
          </p>
        </TabPanel>
        <TabPanel name="settingstab" id="limits" active={section}>
          <h3>Limits</h3>
          <label>
            How long one model call may take, in seconds
            <input
              data-testid="timeout-seconds"
              inputMode="numeric"
              value={form.timeoutSeconds}
              placeholder="180"
              onChange={(ev) => set({ timeoutSeconds: ev.target.value })}
            />
          </label>
          <label>
            Remove finished runs older than this many days (<code>incubator gc</code>)
            <input
              data-testid="gc-days"
              inputMode="numeric"
              value={form.gcDays}
              placeholder="30"
              onChange={(ev) => set({ gcDays: ev.target.value })}
            />
          </label>

          <h3>Where tools live</h3>
          <p className="muted">
            For a tool that is not on your PATH, such as the folder with <code>flutter</code> in it.
          </p>
          {form.toolPaths.map((t, i) => (
            <div className="row" key={i}>
              <input
                aria-label="Tool name"
                data-testid={`tool-name-${i}`}
                value={t.name}
                placeholder="flutter"
                onChange={(ev) =>
                  set({
                    toolPaths: form.toolPaths.map((x, j) =>
                      j === i ? { ...x, name: ev.target.value } : x,
                    ),
                  })
                }
              />
              <input
                aria-label="Full path"
                data-testid={`tool-path-${i}`}
                value={t.path}
                placeholder="full path to the tool"
                onChange={(ev) =>
                  set({
                    toolPaths: form.toolPaths.map((x, j) =>
                      j === i ? { ...x, path: ev.target.value } : x,
                    ),
                  })
                }
              />
              <button
                className="secondary"
                onClick={() => set({ toolPaths: form.toolPaths.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="secondary"
            data-testid="add-tool"
            onClick={() => set({ toolPaths: [...form.toolPaths, { name: '', path: '' }] })}
          >
            Add a tool
          </button>
        </TabPanel>
        {problem && <p className="error">{problem}</p>}
        {error && (
          <p className="error" role="alert" data-testid="settings-error">
            {error}
          </p>
        )}
        <div className="actions">
          <button
            data-testid="save-settings"
            disabled={saving || problem !== null}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && (
            <span className="ok" data-testid="settings-saved">
              Saved. It applies to the next run.
            </span>
          )}
        </div>
      </section>

      <section
        className="card wide"
        role="tabpanel"
        id="settingstab-panel-accounts"
        aria-labelledby="settingstab-accounts"
        data-testid="settingstab-panel-accounts"
        hidden={section !== 'accounts'}
      >
        <h3>Tools found</h3>
        <ul className="plain" data-testid="adapters">
          {view.adapters.map((a) => (
            <li key={a.id}>
              <code>{a.id}</code> {a.installed ? `✔ ${a.version ?? ''}` : '✖ not installed'}
              {a.installed && (
                <span className="muted">
                  {' '}
                  · plans: {a.canPlan ? 'yes' : 'no'} · codes: {a.canCode ? 'yes' : 'no'} · choose a
                  model: {a.takesModel ? 'yes' : 'no'}
                </span>
              )}
            </li>
          ))}
        </ul>
        <h3>Accounts</h3>
        <ul className="plain" data-testid="accounts">
          {view.credentials.map((c) => (
            <li key={c.account}>
              <code>{c.account}</code> {c.source ? `✔ from ${c.source}` : '✖ not set'}
            </li>
          ))}
        </ul>
        <p className="muted">
          Secrets are never shown or typed here. To set one, run{' '}
          <code>incubator auth set github</code> (or <code>anthropic</code>, <code>leantime</code>)
          in a terminal.
        </p>
        <h3>About</h3>
        <p className="muted">
          Data folder: <code>{view.about.home}</code> · keychain:{' '}
          {view.about.keychain ? 'available' : 'not available'}
        </p>
      </section>
    </div>
  );
}
