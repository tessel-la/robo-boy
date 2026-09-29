// How a pad component listens to ROS: one subscription per topic it shows, none while the pad is being edited,
// and a status the component can put into words. Every component that displays live data uses this.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import ROSLIB from 'roslib';
import type { GamepadComponentConfig, ROSTopicConfig } from './types';
import {
  formatValue,
  fractionOf,
  levelOf,
  rangeOf,
  readValue,
  toDisplayNumber,
  valuePathOf,
  type ValueLevel,
} from './padValues';
import { describeMismatch } from './dataComponents';

/**
 * - `preview`: the pad is being edited; nothing is subscribed.
 * - `unconfigured`: no topic or message type yet.
 * - `disconnected`: ROS is not connected.
 * - `waiting`: subscribed, nothing received yet.
 * - `live`: at least one message has arrived.
 */
export type TopicStatus = 'preview' | 'unconfigured' | 'disconnected' | 'waiting' | 'live';

interface TopicSubscriptionOptions {
  ros: Ros | null | undefined;
  topic?: string;
  messageType?: string;
  isEditing?: boolean;
  onMessage: (message: unknown) => void;
}

/** Subscribes while there is a topic, a connection and no editing; resubscribes when any of them changes. */
export function useTopicSubscription({ ros, topic, messageType, isEditing = false, onMessage }: TopicSubscriptionOptions): TopicStatus {
  const [status, setStatus] = useState<TopicStatus>(isEditing ? 'preview' : 'waiting');
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const isConnected = Boolean(ros?.isConnected);

  useEffect(() => {
    if (isEditing) { setStatus('preview'); return; }
    if (!topic || !messageType) { setStatus('unconfigured'); return; }
    if (!ros || !isConnected) { setStatus('disconnected'); return; }

    const subscription = new ROSLIB.Topic({ ros, name: topic, messageType });
    setStatus('waiting');
    subscription.subscribe((message: unknown) => {
      setStatus('live');
      onMessageRef.current(message);
    });
    return () => subscription.unsubscribe();
  }, [isConnected, isEditing, messageType, ros, topic]);

  return status;
}

export interface FieldSample {
  raw: unknown;
  at: number;
}

export interface FieldValueState {
  status: TopicStatus;
  /** The latest value at the component's field, or undefined before the first message. */
  latest: FieldSample | undefined;
  /** The most recent values, oldest first (only the latest unless a history was asked for). */
  history: FieldSample[];
  /** No message within the component's `staleAfterMs`. */
  isStale: boolean;
}

/**
 * The value at a data component's field (`action.field`), live. Fast topics repaint at most once a frame; a
 * component with `staleAfterMs` is told when its topic goes quiet.
 */
export function useFieldValue(
  component: Pick<GamepadComponentConfig, 'action' | 'config'>,
  ros: Ros | null | undefined,
  isEditing = false,
  historyLength = 1
): FieldValueState {
  const action = component.action as ROSTopicConfig | undefined;
  const path = valuePathOf(component);
  const staleAfterMs = component.config?.staleAfterMs ?? 0;
  const keep = Math.max(1, Math.min(200, Math.round(historyLength)));
  const bufferRef = useRef<FieldSample[]>([]);
  const frameRef = useRef<number | null>(null);
  const [history, setHistory] = useState<FieldSample[]>([]);
  const [isStale, setIsStale] = useState(false);

  // A different topic or field starts from nothing.
  useEffect(() => {
    bufferRef.current = [];
    setHistory([]);
  }, [action?.topic, action?.messageType, path]);

  useEffect(() => () => {
    if (frameRef.current !== null && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frameRef.current);
  }, []);

  const onMessage = useCallback((message: unknown) => {
    bufferRef.current = [...bufferRef.current, { raw: readValue(message, path), at: Date.now() }].slice(-keep);
    if (frameRef.current !== null) return;
    const flush = () => { frameRef.current = null; setHistory(bufferRef.current); };
    if (typeof window.requestAnimationFrame !== 'function') { flush(); return; }
    // Marked as scheduled first: a frame callback that runs at once has already cleared the mark.
    frameRef.current = -1;
    const frame = window.requestAnimationFrame(flush);
    if (frameRef.current === -1) frameRef.current = frame;
  }, [keep, path]);

  const status = useTopicSubscription({ ros, topic: action?.topic, messageType: action?.messageType, isEditing, onMessage });
  const latest = history[history.length - 1];

  useEffect(() => {
    setIsStale(false);
    if (!latest || !(staleAfterMs > 0) || isEditing) return;
    const timer = setTimeout(() => setIsStale(true), Math.max(0, staleAfterMs - (Date.now() - latest.at)));
    return () => clearTimeout(timer);
  }, [isEditing, latest, staleAfterMs]);

  return { status, latest, history, isStale };
}

/** The status line a data component shows while it has no value, or undefined once it has one. */
export function statusMessage(status: TopicStatus, action?: Pick<ROSTopicConfig, 'topic'>): string | undefined {
  switch (status) {
    case 'unconfigured': return 'No topic selected';
    case 'disconnected': return 'ROS disconnected';
    case 'waiting': return `Waiting for ${action?.topic || 'data'}…`;
    default: return undefined;
  }
}

/** How long a value has gone without an update, in words short enough for a badge's tooltip. */
export function staleText(isStale: boolean, latest: FieldSample | undefined): string | undefined {
  if (!isStale || !latest) return undefined;
  const ms = Date.now() - latest.at;
  return `No update for ${ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`}`;
}

/** Where the value sits in the range while a pad is edited: somewhere a gauge or bar reads as one. */
export const PREVIEW_FRACTION = 0.62;

export interface NumericReading {
  /** The shown value (scaled and offset), or null when there is none to show. */
  value: number | null;
  /** The value as it is displayed, `—` without one. */
  text: string;
  range: { min: number; max: number };
  /** Where the value sits in its range, 0–1. */
  fraction: number;
  level: ValueLevel;
  /** Why there is no value to show, if there is none. */
  notice?: string;
  /** How long the value has gone without an update, once that is longer than `staleAfterMs`. */
  staleFor?: string;
}

/** A numeric field as gauges, bars and readouts show it: scaled, formatted, placed on its range, and explained. */
export function useNumericReading(
  component: Pick<GamepadComponentConfig, 'action' | 'config'>,
  ros: Ros | null | undefined,
  isEditing = false
): NumericReading {
  const config = component.config ?? {};
  const range = rangeOf(config);
  const { status, latest, isStale } = useFieldValue(component, ros, isEditing);
  const path = valuePathOf(component);

  const value = status === 'preview'
    ? range.min + (range.max - range.min) * PREVIEW_FRACTION
    : latest ? toDisplayNumber(latest.raw, config) : null;
  const notice = statusMessage(status, component.action as ROSTopicConfig | undefined)
    ?? (latest && value === null ? describeMismatch(latest.raw, path, ['number']) : undefined);

  return {
    value,
    // A readout has no range: its decimals follow the value.
    text: formatValue(value, config, Number.isFinite(config.min) || Number.isFinite(config.max) ? range : undefined),
    range,
    fraction: value === null ? 0 : fractionOf(value, range),
    level: levelOf(value, config),
    notice,
    staleFor: staleText(isStale, latest),
  };
}
