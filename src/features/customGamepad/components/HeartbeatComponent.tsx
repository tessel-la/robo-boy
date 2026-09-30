import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';
import { getValueAtPath } from '../rosMessageUtils';
import { useTopicSubscription } from '../useTopicSubscription';
import './DataDisplayComponents.css';

interface HeartbeatComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

type HeartbeatStatus = 'waiting' | 'healthy' | 'unhealthy' | 'disconnected';

export function isHeartbeatValueActive(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    return ['true', '1', 'on', 'yes', 'alive', 'ok', 'healthy'].includes(value.trim().toLowerCase());
  }
  return false;
}

const HeartbeatComponent: React.FC<HeartbeatComponentProps> = ({
  config,
  ros,
  isEditing = false,
  scaleFactor = 1,
}) => {
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<HeartbeatStatus>(isEditing ? 'healthy' : 'waiting');
  const action = config.action as ROSTopicConfig | undefined;
  const mode = config.config?.heartbeatMode ?? 'boolean';
  const timeoutMs = Math.max(100, config.config?.heartbeatTimeoutMs ?? 2000);
  const fieldPath = config.config?.heartbeatFieldPath || action?.field || 'data';

  const clearStaleTimer = useCallback(() => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    staleTimerRef.current = null;
  }, []);
  // A recurring heartbeat is healthy only while messages keep coming.
  const scheduleStaleTimer = useCallback(() => {
    clearStaleTimer();
    staleTimerRef.current = setTimeout(() => {
      staleTimerRef.current = null;
      setStatus('unhealthy');
    }, timeoutMs);
  }, [clearStaleTimer, timeoutMs]);

  const onMessage = useCallback((message: unknown) => {
    if (mode === 'boolean') {
      setStatus(isHeartbeatValueActive(getValueAtPath(message, fieldPath)) ? 'healthy' : 'unhealthy');
      return;
    }
    setStatus('healthy');
    scheduleStaleTimer();
  }, [fieldPath, mode, scheduleStaleTimer]);

  const topicStatus = useTopicSubscription({ ros, topic: action?.topic, messageType: action?.messageType, isEditing, onMessage });

  // Until messages decide it, the heartbeat follows the subscription.
  useEffect(() => {
    if (topicStatus === 'live') return;
    clearStaleTimer();
    if (topicStatus === 'preview') setStatus('healthy');
    else if (topicStatus === 'unconfigured') setStatus('unhealthy');
    else if (topicStatus === 'disconnected') setStatus('disconnected');
    else {
      setStatus('waiting');
      if (mode === 'pulse') scheduleStaleTimer();
    }
  }, [clearStaleTimer, mode, scheduleStaleTimer, topicStatus]);

  useEffect(() => clearStaleTimer, [clearStaleTimer]);

  const description = status === 'healthy'
    ? 'Heartbeat healthy'
    : status === 'waiting'
      ? 'Waiting for heartbeat'
      : status === 'disconnected'
        ? 'ROS disconnected'
        : 'Heartbeat unhealthy';
  const label = config.label?.trim() || action?.topic || 'Heartbeat';
  const labelFontSize = Math.max(8, Math.floor(10 * scaleFactor));

  return (
    <div
      className={`data-display-component heartbeat-pad-component heartbeat-${status}`}
      data-testid="heartbeat-component"
      role="status"
      aria-label={`${label}: ${description}`}
      title={`${description}${action?.topic ? `: ${action.topic}` : ''}`}
    >
      <span className="heartbeat-label" style={{ fontSize: labelFontSize }}>{label}</span>
      <span className="heartbeat-dot" aria-hidden="true" />
    </div>
  );
};

export default HeartbeatComponent;
