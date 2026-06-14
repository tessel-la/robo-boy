import React, { useEffect, useRef, useState } from 'react';
import type { Ros, Topic } from 'roslib';
import ROSLIB from 'roslib';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';
import { getValueAtPath } from '../rosMessageUtils';
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
  const topicRef = useRef<Topic | null>(null);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<HeartbeatStatus>(isEditing ? 'healthy' : 'waiting');
  const action = config.action as ROSTopicConfig | undefined;
  const mode = config.config?.heartbeatMode ?? 'boolean';
  const timeoutMs = Math.max(100, config.config?.heartbeatTimeoutMs ?? 2000);
  const fieldPath = config.config?.heartbeatFieldPath || action?.field || 'data';

  useEffect(() => {
    const clearStaleTimer = () => {
      if (staleTimerRef.current) {
        clearTimeout(staleTimerRef.current);
        staleTimerRef.current = null;
      }
    };
    const scheduleStaleTimer = () => {
      clearStaleTimer();
      staleTimerRef.current = setTimeout(() => {
        staleTimerRef.current = null;
        setStatus('unhealthy');
      }, timeoutMs);
    };

    clearStaleTimer();

    if (isEditing) {
      setStatus('healthy');
      return;
    }

    if (!action?.topic || !action.messageType) {
      setStatus('unhealthy');
      return;
    }

    if (!ros?.isConnected) {
      setStatus('disconnected');
      return;
    }

    const topic = new ROSLIB.Topic({
      ros,
      name: action.topic,
      messageType: action.messageType,
    });

    setStatus('waiting');
    topic.subscribe((message: unknown) => {
      if (mode === 'boolean') {
        setStatus(isHeartbeatValueActive(getValueAtPath(message, fieldPath)) ? 'healthy' : 'unhealthy');
        return;
      }

      setStatus('healthy');
      scheduleStaleTimer();
    });
    topicRef.current = topic;
    if (mode === 'pulse') scheduleStaleTimer();

    return () => {
      clearStaleTimer();
      topic.unsubscribe();
      topicRef.current = null;
    };
  }, [action?.messageType, action?.topic, fieldPath, isEditing, mode, ros, ros?.isConnected, timeoutMs]);

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
