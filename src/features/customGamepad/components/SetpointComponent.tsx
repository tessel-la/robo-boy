import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ros, Topic } from 'roslib';
import ROSLIB from 'roslib';
import { throttle } from 'lodash-es';
import { FiCheck, FiSend } from 'react-icons/fi';
import type { GamepadComponentConfig, ROSTopicConfig } from '../types';
import { buildFieldMessage, clampToStep, formatValue, rangeOf, valuePathOf } from '../padValues';
import PadValueFrame from './PadValueFrame';

interface SetpointComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

/** Sending on every change is limited to this often, so holding a stepper does not flood the topic. */
const SEND_INTERVAL_MS = 100;

/** The value a setpoint starts at: 0 when its range allows it, otherwise the nearer end. */
export const initialSetpoint = (range: { min: number; max: number }, step?: number) => clampToStep(0, range, step);

/**
 * A numeric command: step it or type it, then send it (or have every change sent). It publishes one field of its
 * message, e.g. `data` of std_msgs/Float64 or `linear.x` of a Twist, leaving the others at their defaults.
 */
const SetpointComponent: React.FC<SetpointComponentProps> = ({ config, ros, isEditing = false }) => {
  const settings = config.config ?? {};
  const action = config.action as ROSTopicConfig | undefined;
  const { min, max } = rangeOf(settings);
  const range = useMemo(() => ({ min, max }), [min, max]);
  const step = settings.step && settings.step > 0 ? settings.step : undefined;
  const increment = step ?? (max - min) / 100;
  const sendOnChange = Boolean(settings.sendOnChange);
  const decimals = settings.decimals;
  const format = useCallback((value: number) => formatValue(value, { decimals }, range), [decimals, range]);
  const [value, setValue] = useState(() => initialSetpoint(range, step));
  const [draft, setDraft] = useState(() => format(value));
  // Nothing is waiting to be sent until the value moves from where it started.
  const [startValue] = useState(value);
  // A new range or step may leave the value outside it: bring it back as soon as the settings change.
  const bounds = `${min}:${max}:${step ?? ''}:${decimals ?? ''}`;
  const [appliedBounds, setAppliedBounds] = useState(bounds);
  if (bounds !== appliedBounds) {
    const next = clampToStep(value, range, step);
    setAppliedBounds(bounds);
    setValue(next);
    setDraft(format(next));
  }
  const [sent, setSent] = useState<number | null>(null);
  const topicRef = useRef<Topic | null>(null);
  const label = config.label?.trim();
  const unit = settings.unit?.trim() ?? '';
  const path = valuePathOf(config);
  const messageType = action?.messageType ?? '';
  const fieldType = settings.fieldType;
  const isConnected = Boolean(ros?.isConnected);

  useEffect(() => {
    if (isEditing || !ros || !action?.topic || !messageType) return;
    const topic = new ROSLIB.Topic({ ros, name: action.topic, messageType });
    topic.advertise();
    topicRef.current = topic;
    setSent(null);
    return () => {
      topic.unadvertise();
      topicRef.current = null;
    };
  }, [action?.topic, isEditing, messageType, ros]);

  const send = useCallback((next: number) => {
    if (!topicRef.current || isEditing) return;
    topicRef.current.publish(new ROSLIB.Message(buildFieldMessage(messageType, path, next, fieldType)));
    setSent(next);
  }, [fieldType, isEditing, messageType, path]);

  const sendThrottled = useMemo(() => throttle(send, SEND_INTERVAL_MS, { leading: true, trailing: true }), [send]);
  useEffect(() => () => sendThrottled.cancel(), [sendThrottled]);

  const change = (requested: number) => {
    const next = clampToStep(requested, range, step);
    setValue(next);
    setDraft(format(next));
    if (sendOnChange) sendThrottled(next);
    return next;
  };

  const commitDraft = () => {
    const parsed = Number(draft);
    return Number.isFinite(parsed) && draft.trim() !== '' ? change(parsed) : change(value);
  };

  const canSend = !isEditing && isConnected && Boolean(action?.topic && messageType);
  const aside = isEditing
    ? undefined
    : !action?.topic
      ? 'No topic'
      : !isConnected
        ? 'ROS disconnected'
        : sent !== null
          ? <><FiCheck aria-hidden="true" /> {format(sent)}</>
          : undefined;
  const name = label || 'Setpoint';

  return (
    <PadValueFrame
      kind="setpoint"
      className={canSend && !sendOnChange && value !== (sent ?? startValue) ? 'is-pending' : undefined}
      label={label}
      aside={aside}
      data-testid="setpoint-component"
      role="group"
      aria-label={name}
    >
      <div className="pad-setpoint-controls">
        <button
          type="button"
          className="pad-setpoint-step"
          onClick={() => change(value - increment)}
          disabled={isEditing || value <= range.min}
          aria-label={`Decrease ${name}`}
        >
          −
        </button>
        <label className="pad-setpoint-field">
          <input
            type="number"
            inputMode="decimal"
            value={draft}
            min={range.min}
            max={range.max}
            step={step ?? 'any'}
            disabled={isEditing}
            aria-label={`${name} value`}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              const next = commitDraft();
              if (!sendOnChange && canSend) send(next);
            }}
          />
          {unit && <small>{unit}</small>}
        </label>
        <button
          type="button"
          className="pad-setpoint-step"
          onClick={() => change(value + increment)}
          disabled={isEditing || value >= range.max}
          aria-label={`Increase ${name}`}
        >
          +
        </button>
        {!sendOnChange && (
          <button
            type="button"
            className="pad-setpoint-send"
            onClick={() => send(value)}
            disabled={!canSend || sent === value}
            aria-label={`Send ${name}`}
            title={sent === value ? 'Sent' : `Send ${format(value)}${unit ? ` ${unit}` : ''} to ${action?.topic ?? 'the topic'}`}
          >
            {sent === value ? <FiCheck aria-hidden="true" /> : <FiSend aria-hidden="true" />}
            <span>{sent === value ? 'Sent' : 'Send'}</span>
          </button>
        )}
      </div>
    </PadValueFrame>
  );
};

export default SetpointComponent;
