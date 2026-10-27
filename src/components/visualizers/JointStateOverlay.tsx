import { useEffect, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import type { Ros } from 'roslib';
import { FiMove, FiMaximize2 } from 'react-icons/fi';
import { useJointStates } from '../../hooks/useJointStates';
import { useOverlayFrame } from '../../hooks/useOverlayFrame';
import { normalizeJointStateOptions, type JointStateOptions } from '../../utils/jointStates';
import './JointStateOverlay.css';

const number = (value: number | undefined) => (value === undefined ? '—' : value.toFixed(3));
export default function JointStateOverlay({
  ros,
  topic,
  messageType,
  options,
  descriptionTopic,
  container,
  id,
  onChange,
  onStatus,
}: {
  ros: Ros | null;
  topic: string;
  messageType: string;
  options?: JointStateOptions;
  descriptionTopic: string;
  container: RefObject<HTMLDivElement | null>;
  id: string;
  onChange: (id: string, patch: JointStateOptions) => void;
  onStatus: (id: string, status: string | null) => void;
}) {
  const values = normalizeJointStateOptions(options);
  const data = useJointStates(ros, topic, messageType, descriptionTopic);
  const layout = useOverlayFrame(container, options?.frame, frame => onChange(id, { frame }));
  const status = !ros
    ? 'Disconnected.'
    : data.messageError || (!data.joints.length ? 'Waiting for joint states.' : null);
  useEffect(() => {
    onStatus(id, status);
  }, [id, status, onStatus]);
  const joints = data.joints.filter(joint => joint.name.toLowerCase().includes(values.filter.toLowerCase()));
  const keyboard = (event: KeyboardEvent, resize: boolean) => {
    const delta = (
      { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>
    )[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 20 : 5;
    const f = layout.frame;
    layout.change(
      resize
        ? { ...f, width: f.width + delta[0] * step, height: f.height + delta[1] * step }
        : { ...f, left: f.left + delta[0] * step, top: f.top + delta[1] * step }
    );
  };
  if (!values.visible) return null;
  return (
    <section
      className="joint-state-overlay"
      aria-label={`Joint states on ${topic}`}
      style={{ ...layout.frame, '--joint-background-opacity': `${values.backgroundOpacity * 100}%` } as CSSProperties}
      onPointerDown={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
    >
      <header className="joint-state-header">
        <button
          type="button"
          className="joint-state-move"
          aria-label={`Move joint states on ${topic}`}
          title="Drag to move; arrow keys to move"
          onPointerDown={event => layout.start(event, false)}
          onPointerMove={layout.move}
          onPointerUp={layout.end}
          onPointerCancel={layout.end}
          onLostPointerCapture={layout.end}
          onKeyDown={event => keyboard(event, false)}
        >
          <FiMove aria-hidden="true" />
          <span>Joint states</span>
        </button>
        <span className="joint-state-count">{joints.length}</span>
      </header>
      <div className="joint-state-body">
        <p className="joint-state-topic" title={topic}>
          {topic}
        </p>
        {status && (
          <p role="status" className="joint-state-note">
            {status}
          </p>
        )}
        {data.descriptionError && (
          <p role="status" className="joint-state-note">
            {data.descriptionError}
          </p>
        )}
        {!descriptionTopic && (
          <p className="joint-state-note">Select a robot description in Display settings to show limits.</p>
        )}
        {!!descriptionTopic && !data.descriptionLoaded && !data.descriptionError && (
          <p className="joint-state-note">Waiting for robot description; limits unavailable.</p>
        )}
        {!!data.joints.length && !joints.length && <p className="joint-state-note">No joints match the filter.</p>}
        {joints.map(joint => {
          const limits = Object.prototype.hasOwnProperty.call(data.limits, joint.name)
            ? data.limits[joint.name]
            : undefined;
          const angular = limits?.type === 'revolute' || limits?.type === 'continuous';
          const factor = angular && values.angleUnit === 'deg' ? 180 / Math.PI : 1;
          const unit = angular ? values.angleUnit : limits?.type === 'prismatic' ? 'm' : '';
          const lower = limits?.lower,
            upper = limits?.upper;
          const bounded = lower !== undefined && upper !== undefined;
          const outside =
            joint.position !== undefined &&
            ((lower !== undefined && joint.position < lower) || (upper !== undefined && joint.position > upper));
          const stale = !data.replay && data.now - joint.receivedAt > 2000;
          const progress =
            bounded && joint.position !== undefined
              ? Math.max(0, Math.min(100, upper === lower ? 50 : ((joint.position - lower) / (upper - lower)) * 100))
              : undefined;
          return (
            <article
              key={joint.name}
              className={`joint-state-row${outside ? ' is-outside' : ''}${stale ? ' is-stale' : ''}`}
            >
              <div className="joint-state-value-row">
                <span className="joint-state-name" title={joint.name}>
                  {joint.name}
                </span>
                <span className="joint-state-value">
                  {number(joint.position === undefined ? undefined : joint.position * factor)} <small>{unit}</small>
                </span>
              </div>
              {progress !== undefined && (
                <div
                  className="joint-state-track"
                  role="meter"
                  aria-label={`${joint.name} position`}
                  aria-valuemin={lower! * factor}
                  aria-valuemax={upper! * factor}
                  aria-valuenow={Math.max(lower!, Math.min(upper!, joint.position!)) * factor}
                  aria-valuetext={`${number(joint.position! * factor)} ${unit}${outside ? ', outside limits' : ''}`}
                >
                  <span style={{ width: `${progress}%` }} />
                </div>
              )}
              <div className="joint-state-limits">
                <span>
                  {lower !== undefined
                    ? `Min ${number(lower * factor)} ${unit}`
                    : limits?.type === 'continuous'
                      ? 'Continuous · no position limits'
                      : 'Limits unavailable'}
                </span>
                {upper !== undefined && (
                  <span>
                    Max {number(upper * factor)} {unit}
                  </span>
                )}
              </div>
              {(stale || outside) && (
                <div className="joint-state-warning">{stale ? 'Stale reading' : 'Outside position limits'}</div>
              )}
              {(values.showVelocity || values.showEffort) && (
                <div className="joint-state-extra">
                  {values.showVelocity && (
                    <span>
                      Velocity {number(joint.velocity === undefined ? undefined : joint.velocity * factor)}{' '}
                      {unit ? `${unit}/s` : ''}
                      {limits?.velocity !== undefined ? ` · max ${number(limits.velocity * factor)}` : ''}
                    </span>
                  )}
                  {values.showEffort && (
                    <span>
                      Effort {number(joint.effort)} {angular ? 'N·m' : limits?.type === 'prismatic' ? 'N' : ''}
                      {limits?.effort !== undefined ? ` · max ${number(limits.effort)}` : ''}
                    </span>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <button
        type="button"
        className="joint-state-resize"
        aria-label={`Resize joint states on ${topic}`}
        title="Drag to resize; arrow keys to resize"
        onPointerDown={event => layout.start(event, true)}
        onPointerMove={layout.move}
        onPointerUp={layout.end}
        onPointerCancel={layout.end}
        onLostPointerCapture={layout.end}
        onKeyDown={event => keyboard(event, true)}
      >
        <FiMaximize2 aria-hidden="true" />
      </button>
    </section>
  );
}
