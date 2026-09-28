import { useEffect, useState } from 'react';
import { FiCheck, FiMonitor, FiX } from 'react-icons/fi';
import { MdOutlineSmartToy } from 'react-icons/md';
import './WorkspaceOpening.css';

export type WorkspaceOpeningStage = 'loading' | 'connecting' | 'connected' | 'failed';

/** How long the connected state shows before the workspace takes over (the link fills, then it fades). */
export const WORKSPACE_OPENING_EXIT_MS = 800;
/** After this long without an answer the screen says so and offers a way out. */
const SLOW_AFTER_S = 8;

interface WorkspaceOpeningProps {
  stage: WorkspaceOpeningStage;
  /** The robot as the connection tabs name it: a host, or a ROS domain. */
  target: string;
  /** Where rosbridge is being reached. */
  url?: string;
  /** Local recordings: there is no robot to reach, only the workspace to open. */
  offline?: boolean;
  /** Changes with every connection attempt, so the wait is counted from the latest one. */
  attempt?: number;
  /** Drawn before the workspace exists: it also stands in for the top bar. */
  standalone?: boolean;
  onRetry?: () => void;
  onContinue?: () => void;
  onCancel?: () => void;
}

type StepState = 'pending' | 'active' | 'done' | 'failed';

function StepMark({ state }: { state: StepState }) {
  return (
    <span className="workspace-opening-mark" aria-hidden="true">
      {state === 'done' ? <FiCheck /> : state === 'failed' ? <FiX /> : null}
    </span>
  );
}

/** Seconds since `stage` last became 'connecting' (or the attempt changed), counted while it is. */
function useSecondsConnecting(stage: WorkspaceOpeningStage, attempt: number | undefined) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (stage !== 'connecting') return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [stage, attempt]);
  return seconds;
}

/**
 * What a workspace shows while it opens: its code arriving, then the link to the robot being made,
 * drawn as the brand's dash travelling from this device to the robot. It says how long the robot has
 * been silent, and when the link fails it says what to check and offers a way on.
 */
export default function WorkspaceOpening({ stage, target, url, offline, attempt, standalone, onRetry, onContinue, onCancel }: WorkspaceOpeningProps) {
  const seconds = useSecondsConnecting(stage, attempt);
  const slow = stage === 'connecting' && seconds >= SLOW_AFTER_S;
  const workspaceStep: StepState = stage === 'loading' ? 'active' : 'done';
  const robotStep: StepState = { loading: 'pending', connecting: 'active', connected: 'done', failed: 'failed' }[stage] as StepState;
  const robotText = {
    loading: `Connect to ${target}`,
    connecting: `Connecting to ${target}`,
    connected: `Connected to ${target}`,
    failed: `Couldn't reach ${target}`,
  }[stage];
  const status = stage === 'loading' ? 'Opening the workspace' : robotText;
  // Where the ROS stack is expected: the host in the address, which a ROS domain alone does not name.
  const where = (url && URL.canParse(url) && new URL(url).hostname) || target;

  return (
    <div className={`workspace-opening is-${stage} ${standalone ? 'is-standalone' : 'is-over-workspace'}`}>
      {standalone && <div className="workspace-opening-bar" aria-hidden="true" />}
      <div className="workspace-opening-stage">
        <div className="workspace-opening-card card" role="status" aria-live="polite" aria-label={status}>
          {!offline && (
            <div className="workspace-opening-link" aria-hidden="true">
              <span className="workspace-opening-node is-device"><FiMonitor /></span>
              <span className="workspace-opening-track">
                <span className="workspace-opening-fill" />
                <span className="workspace-opening-dash" />
                <span className="workspace-opening-break"><FiX /></span>
              </span>
              <span className="workspace-opening-node is-robot"><MdOutlineSmartToy /></span>
            </div>
          )}
          {!offline && (
            <div className="workspace-opening-ends" aria-hidden="true">
              <span>This device</span>
              <span title={target}>{target}</span>
            </div>
          )}

          <ol className="workspace-opening-steps">
            <li className={`workspace-opening-step is-${workspaceStep}`}>
              <StepMark state={workspaceStep} />
              <span className="workspace-opening-step-text">{workspaceStep === 'done' ? 'Workspace ready' : 'Opening the workspace'}</span>
            </li>
            {!offline && (
              <li className={`workspace-opening-step is-${robotStep}`}>
                <StepMark state={robotStep} />
                <span className="workspace-opening-step-text">
                  {robotText}
                  {url && <span className="workspace-opening-url">{url}</span>}
                </span>
                {stage === 'connecting' && seconds > 0 && <span className="workspace-opening-time">{seconds} s</span>}
              </li>
            )}
          </ol>

          {(slow || stage === 'failed') && (
            <p className="workspace-opening-help">
              {stage === 'failed'
                ? `The robot didn't answer. Check that the ROS stack is running on ${where} and that this device can reach it (same network or VPN).`
                : `${target} hasn't answered yet. Check that the ROS stack is running on ${where} and that this device can reach it.`}
            </p>
          )}
          {stage === 'failed' && (
            <div className="workspace-opening-actions">
              <button type="button" className="is-primary" onClick={onRetry}>Try again</button>
              <button type="button" onClick={onContinue}>Open workspace anyway</button>
              <button type="button" className="is-link" onClick={onCancel}>Back to connections</button>
            </div>
          )}
          {slow && (
            <div className="workspace-opening-actions">
              <button type="button" onClick={onContinue}>Open workspace anyway</button>
              <button type="button" className="is-link" onClick={onCancel}>Back to connections</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
