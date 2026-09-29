import React, { useEffect, useState } from 'react';
import { FiCheck, FiCopy, FiX } from 'react-icons/fi';
import {
  describePhase,
  extractDiagnostics,
  goalStatusName,
  isEmptyPayload,
  summarizeExecution,
  type ExecutionErrorSource,
  type ExecutionRecord,
} from '../../execution/executionModel';
import ValueInspector, { payloadToJson } from './ValueInspector';
import './ExecutionDetails.css';

const SOURCE_LABELS: Record<ExecutionErrorSource, string> = {
  ros: 'Reported by ROS',
  timeout: 'Timeout',
  transport: 'Connection',
  client: 'Robo-Boy',
  stopped: 'Tree stopped',
};

const PROGRESS_FIELD = /(progress|percent|percentage|completion|completed_ratio)$/i;

/** Numeric feedback fields that read as progress (0–1 or 0–100), for a bar each. */
export function progressFields(payload: unknown): Array<{ name: string; fraction: number }> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter((entry): entry is [string, number] => PROGRESS_FIELD.test(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .map(([name, value]) => ({ name, fraction: Math.max(0, Math.min(1, value > 1 ? value / 100 : value)) }));
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** Ticks while an execution runs, so its elapsed time and the age of its feedback stay current. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return active ? now : Date.now();
}

interface ExecutionDetailsCardProps {
  record: ExecutionRecord | undefined;
  nodeLabel: string;
  onClose: () => void;
}

/**
 * Everything the latest execution of an action or service node reported: its state, what went wrong, its latest
 * feedback and its result or response. One card for both kinds, whatever the payload.
 */
const ExecutionDetailsCard: React.FC<ExecutionDetailsCardProps> = ({ record, nodeLabel, onClose }) => {
  const [copied, setCopied] = useState(false);
  const now = useNow(record?.phase === 'running');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('.bt-image-lightbox')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => setCopied(false), [record?.attemptId]);

  const isAction = record?.kind === 'action';
  const summary = record ? summarizeExecution(record) : undefined;
  const diagnostics = record?.hasResult ? extractDiagnostics(record.result) : undefined;
  const resultLabel = isAction ? 'Result' : 'Response';

  const copy = () => {
    if (!record) return;
    const payload = {
      kind: record.kind,
      target: record.target,
      type: record.rosType,
      state: describePhase(record),
      goalStatus: goalStatusName(record.goalStatus),
      error: record.error,
      feedback: record.feedback?.payload,
      [isAction ? 'result' : 'response']: record.result,
    };
    void navigator.clipboard?.writeText(payloadToJson(payload)).then(() => setCopied(true), () => setCopied(false));
  };

  return (
    <section className={`bt-exec-card tone-${summary?.tone ?? 'neutral'}`} role="dialog" aria-label={`${nodeLabel} execution details`}>
      <header className="bt-exec-card-header">
        <div className="bt-exec-card-heading">
          <span className="bt-exec-card-kicker">
            <i aria-hidden="true" />
            {record ? `${isAction ? 'Action' : 'Service'} · ${summary?.label}` : 'Execution details'}
          </span>
          <h4 title={nodeLabel}>{nodeLabel}</h4>
          {record && (
            <span className="bt-exec-card-target" title={`${record.target}${record.rosType ? ` (${record.rosType})` : ''}`}>
              {record.target}
              {record.rosType && <small>{record.rosType}</small>}
            </span>
          )}
        </div>
        <button type="button" className="bt-exec-card-close" onClick={onClose} aria-label="Close execution details">
          <FiX aria-hidden="true" />
        </button>
      </header>

      {!record ? (
        <div className="bt-exec-card-body">
          <p className="bt-exec-empty">This node has not run since the tree was loaded or last started.</p>
        </div>
      ) : (
        <div className="bt-exec-card-body">
          <dl className="bt-exec-meta">
            <div><dt>Started</dt><dd>{time(record.startedAt)}</dd></div>
            <div>
              <dt>{record.phase === 'running' ? 'Running for' : 'Took'}</dt>
              <dd>{duration((record.endedAt ?? now) - record.startedAt)}</dd>
            </div>
            {record.goalStatus !== undefined && (
              <div><dt>Goal status</dt><dd>{goalStatusName(record.goalStatus)} ({record.goalStatus})</dd></div>
            )}
          </dl>

          {record.error && (
            <section className="bt-exec-section problem" aria-label="What went wrong">
              <h5>What went wrong</h5>
              <p className="bt-exec-message">{record.error.message}</p>
              <div className="bt-exec-chips">
                <span>{SOURCE_LABELS[record.error.source]}</span>
                {record.error.code !== undefined && <span>Code {String(record.error.code)}</span>}
              </div>
              {record.error.details !== undefined && !isEmptyPayload(record.error.details) && (
                <ValueInspector value={record.error.details} label="details" />
              )}
            </section>
          )}

          {!record.error && diagnostics?.reportsFailure && (
            <section className="bt-exec-section warning" aria-label="Reported failure">
              <h5>{isAction ? 'The result reports a failure' : 'The service reported a failure'}</h5>
              {diagnostics.message && <p className="bt-exec-message">{diagnostics.message}</p>}
              {diagnostics.code !== undefined && <div className="bt-exec-chips"><span>Code {String(diagnostics.code)}</span></div>}
            </section>
          )}

          {record.feedback && (
            <section className="bt-exec-section" aria-label="Feedback">
              <h5>
                Feedback
                <small>
                  {record.feedback.count === 1 ? '1 message' : `Latest of ${record.feedback.count}`} · {duration(Math.max(0, now - record.feedback.receivedAt))} ago
                </small>
              </h5>
              {progressFields(record.feedback.payload).map(field => (
                <div className="bt-exec-progress" key={field.name}>
                  <span>{field.name}</span>
                  <div role="progressbar" aria-label={field.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(field.fraction * 100)}>
                    <i style={{ width: `${field.fraction * 100}%` }} />
                  </div>
                  <b>{Math.round(field.fraction * 100)}%</b>
                </div>
              ))}
              <ValueInspector value={record.feedback.payload} label="feedback" emptyText="Empty feedback" />
            </section>
          )}

          {record.hasResult && (
            <section className="bt-exec-section" aria-label={resultLabel}>
              <h5>{resultLabel}</h5>
              <ValueInspector value={record.result} label={resultLabel.toLowerCase()} emptyText={`No ${resultLabel.toLowerCase()} fields`} />
            </section>
          )}

          {record.phase === 'running' && !record.feedback && (
            <p className="bt-exec-empty">{isAction ? 'Waiting for feedback or a result…' : 'Waiting for the response…'}</p>
          )}
        </div>
      )}

      {record && (record.hasResult || record.feedback || record.error) && (
        <footer className="bt-exec-card-footer">
          <button type="button" onClick={copy}>
            {copied ? <FiCheck aria-hidden="true" /> : <FiCopy aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy as JSON'}
          </button>
        </footer>
      )}
    </section>
  );
};

export default ExecutionDetailsCard;
