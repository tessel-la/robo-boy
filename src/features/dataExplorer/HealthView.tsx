import { useState } from 'react';
import { FiPause, FiPlay } from 'react-icons/fi';
import { ageLabel, ruleIssues, type RuleState } from './model';
import type { ExplorerConfig, InspectionSnapshot, Rule } from './types';

export const severity = (level: number) => ['Healthy', 'Warning', 'Error', 'Stale'][level] ?? 'Unknown';
export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
interface Props {
  snapshot: InspectionSnapshot;
  config: ExplorerConfig;
  /** Rule states after the grace period, from the panel's rule monitor. */
  ruleStates: ReadonlyMap<string, RuleState>;
  /** Kept by the panel so a topic's rule icon can open Health → Rules directly. */
  section: HealthSection;
  onSection: (section: HealthSection) => void;
  onChange: (patch: Partial<ExplorerConfig>) => void;
  onSelect: (id: string) => void;
}
export type HealthSection = 'diagnostics' | 'logs' | 'events' | 'rules';
export default function HealthView({ snapshot, config, ruleStates, section, onSection, onChange, onSelect }: Props) {
  const setSection = onSection;
  const [logQuery, setLogQuery] = useState('');
  const [minLevel, setMinLevel] = useState(0);
  const [frozen, setFrozen] = useState<InspectionSnapshot['logs']>();
  const diagnostics = snapshot.diagnostics.filter(
    item =>
      item.source === config.diagnosticTopic &&
      `${item.name} ${item.hardware} ${item.message}`.toLowerCase().includes(config.query.toLowerCase())
  );
  const issueCount = diagnostics.filter(
    item => item.level > 0 || snapshot.now - item.receivedAt > config.staleSec * 1000
  ).length;
  const violatedRules = config.rules.filter(rule => (ruleStates.get(rule.topic)?.issues.length ?? 0) > 0).length;
  const updateRule = (index: number, patch: Partial<Rule>) =>
    onChange({ rules: config.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) });
  return (
    <div className="de-health">
      <div className="de-health-summary">
        <strong>
          {diagnostics.length} component{diagnostics.length === 1 ? '' : 's'}
        </strong>
        <span>{issueCount ? `${issueCount} need${issueCount === 1 ? 's' : ''} attention` : 'all healthy'}</span>
        <span>
          {config.rules.length} topic rule{config.rules.length === 1 ? '' : 's'}
          {violatedRules ? ` · ${violatedRules} violated` : ''}
        </span>
      </div>
      <nav className="de-subtabs" aria-label="Health views">
        {(['diagnostics', 'logs', 'events', 'rules'] as const).map(view => (
          <button key={view} aria-pressed={section === view} onClick={() => setSection(view)}>
            {view[0].toUpperCase() + view.slice(1)}
          </button>
        ))}
      </nav>
      {section === 'diagnostics' && (
        <>
          <div className="de-health-options">
            <label>
              Diagnostic source
              <select
                value={config.diagnosticTopic}
                onChange={event => onChange({ diagnosticTopic: event.target.value })}
              >
                {[
                  ...new Set([
                    '/diagnostics',
                    '/diagnostics_agg',
                    ...snapshot.resources
                      .filter(resource => resource.types.some(type => type.endsWith('/DiagnosticArray')))
                      .map(resource => resource.name),
                    config.diagnosticTopic,
                  ]),
                ].map(name => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              Stale after (s)
              <input
                type="number"
                min={1}
                max={3600}
                value={config.staleSec}
                onChange={event => onChange({ staleSec: Math.max(1, Number(event.target.value)) })}
              />
            </label>
          </div>
          {!diagnostics.length && (
            <p className="de-empty">
              Waiting for diagnostics from {config.diagnosticTopic}. An empty list does not mean the robot is healthy.
            </p>
          )}
          {diagnostics.map(item => {
            const stale = snapshot.now - item.receivedAt > config.staleSec * 1000;
            return (
              <details className="de-diagnostic" key={item.id}>
                <summary>
                  <span className="de-severity" data-level={stale ? 3 : item.level}>
                    {stale ? 'Update stale' : severity(item.level)}
                  </span>
                  <strong>{item.name}</strong>
                  <small>{ageLabel(Math.max(0, snapshot.now - item.receivedAt) / 1000)} ago</small>
                </summary>
                <p>{item.message}</p>
                <p className="de-muted">
                  Hardware: {item.hardware || 'Not reported'} · Reported: {severity(item.level)}
                </p>
                <dl>
                  {item.values.map((pair, index) => (
                    <div key={index}>
                      <dt>{pair.key}</dt>
                      <dd>{pair.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            );
          })}
        </>
      )}
      {section === 'logs' && (
        <>
          <div className="de-log-controls">
            <input
              aria-label="Filter logs"
              placeholder="Find logger or message…"
              value={logQuery}
              onChange={event => setLogQuery(event.target.value)}
            />
            <select
              aria-label="Minimum log severity"
              value={minLevel}
              onChange={event => setMinLevel(Number(event.target.value))}
            >
              <option value={0}>All levels</option>
              <option value={20}>Info+</option>
              <option value={30}>Warning+</option>
              <option value={40}>Error+</option>
            </select>
            <button
              aria-label={frozen ? 'Resume logs' : 'Freeze logs'}
              title={frozen ? 'Resume logs' : 'Freeze logs'}
              onClick={() => setFrozen(frozen ? undefined : snapshot.logs)}
            >
              {frozen ? <FiPlay /> : <FiPause />}
            </button>
          </div>
          <p className="de-muted">Last 200 entries · repeated adjacent messages are folded</p>
          <ol className="de-log-list">
            {(frozen ?? snapshot.logs)
              .filter(
                log =>
                  log.level >= minLevel && `${log.name} ${log.message}`.toLowerCase().includes(logQuery.toLowerCase())
              )
              .slice()
              .reverse()
              .map(log => (
                <li key={log.id}>
                  <time>{new Date(log.receivedAt).toLocaleTimeString()}</time>
                  <span className="de-severity" data-level={log.level >= 40 ? 2 : log.level >= 30 ? 1 : 0}>
                    {log.level >= 40 ? 'Error' : log.level >= 30 ? 'Warn' : 'Info'}
                  </span>
                  <strong>{log.name}</strong>
                  <p>
                    {log.message}
                    {log.repeats > 1 && <small> ×{log.repeats}</small>}
                  </p>
                </li>
              ))}
          </ol>
        </>
      )}
      {section === 'events' && (
        <>
          <p className="de-muted">Changes observed during this inspection session. Last 200 events.</p>
          <ol className="de-log-list">
            {snapshot.events
              .slice()
              .reverse()
              .map(event => (
                <li key={event.id}>
                  <time>{new Date(event.time).toLocaleTimeString()}</time>
                  {event.level > 0 && (
                    <span className="de-severity" data-level={Math.min(2, event.level)}>
                      {event.level >= 2 ? 'Error' : 'Warn'}
                    </span>
                  )}
                  <p>{event.label}</p>
                </li>
              ))}
          </ol>
        </>
      )}
      {section === 'rules' && (
        <>
          <p className="de-muted">
            Rule topics are watched automatically. A rate is judged once the 10-second window has warmed up; a change
            must last 3 seconds before a rule is reported or cleared, so one late sample does not flip it.
          </p>
          {!config.rules.length && <p className="de-empty">Select a topic and choose “Add health rule”.</p>}
          {config.rules.map((rule, index) => {
            const state = ruleStates.get(rule.topic);
            const issues = state?.issues ?? [];
            // The raw evaluation shows a change the grace period has not confirmed yet.
            const pending = ruleIssues(rule, snapshot).length > 0 !== issues.length > 0;
            const metric = snapshot.metrics[rule.topic];
            return (
              <section className="de-rule" key={rule.topic}>
                <header>
                  <button onClick={() => onSelect(`topic:${rule.topic}`)}>{rule.topic}</button>
                  <button
                    aria-label={`Remove rule ${rule.topic}`}
                    onClick={() => onChange({ rules: config.rules.filter((_, i) => i !== index) })}
                  >
                    ×
                  </button>
                </header>
                <div className="de-rule-fields">
                  {(
                    [
                      ['minHz', 'Minimum Hz'],
                      ['maxHz', 'Maximum Hz'],
                      ['silenceSec', 'Silence timeout (s)'],
                      ['minPublishers', 'Required publishers'],
                      ['minSubscribers', 'Required subscribers'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={rule[key] ?? ''}
                        placeholder="Off"
                        onChange={event =>
                          updateRule(index, {
                            [key]: event.target.value === '' ? undefined : Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                {issues.length ? (
                  <ul className="de-warning">
                    {issues.map(issue => (
                      <li key={issue}>{issue}</li>
                    ))}
                    {state && (
                      <li className="de-muted">Since {ageLabel(Math.max(0, snapshot.now - state.since) / 1000)} ago</li>
                    )}
                  </ul>
                ) : (
                  <p className="de-muted">
                    {metric?.unavailable
                      ? metric.unavailable
                      : metric
                        ? metric.warming
                          ? 'Measurement warming up…'
                          : 'No measured rule violations'
                        : 'Not monitored'}
                  </p>
                )}
                {pending && <p className="de-muted">Change detected; confirming for 3 seconds…</p>}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
