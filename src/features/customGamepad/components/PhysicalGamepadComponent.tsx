import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ROSLIB from 'roslib';
import type { Ros, Topic } from 'roslib';
import { executeRosOperation } from '../../../utils/rosOperations';
import type { GamepadComponentConfig, PhysicalGamepadControlId, ROSTopicConfig } from '../types';
import {
  detectPhysicalGamepadProfile,
  EMPTY_GAMEPAD_SNAPSHOT,
  findPhysicalGamepad,
  getPhysicalGamepadControlLabel,
  PHYSICAL_GAMEPAD_CONTROLS,
  physicalGamepadSnapshotKey,
  snapshotPhysicalGamepad,
  type PhysicalGamepadSnapshot,
} from '../physicalGamepad';
import './PhysicalGamepadComponent.css';

interface Props {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
}

const JOY_PUBLISH_INTERVAL_MS = 50;

const PhysicalGamepadComponent: React.FC<Props> = ({ config, ros, isEditing = false }) => {
  const [snapshot, setSnapshot] = useState<PhysicalGamepadSnapshot>(EMPTY_GAMEPAD_SNAPSHOT);
  const [connection, setConnection] = useState<{ id: string; index: number; mapping: string } | null>(null);
  const [operationError, setOperationError] = useState('');
  const topicRef = useRef<Topic | null>(null);
  const connectedRef = useRef(false);
  const connectionKeyRef = useRef('');
  const previousPressedRef = useRef<boolean[]>(Array(17).fill(false));
  const snapshotKeyRef = useRef('');
  const lastPublishedAtRef = useRef(0);
  const operationControllersRef = useRef(new Map<string, AbortController>());

  const profile = detectPhysicalGamepadProfile(config.config?.physicalGamepadProfile, connection?.id);
  const action = config.action as ROSTopicConfig | undefined;
  const bindings = config.config?.physicalGamepadBindings;

  const publishJoy = useCallback(
    (next: PhysicalGamepadSnapshot) => {
      if (!topicRef.current || isEditing) return;
      topicRef.current.publish(
        new ROSLIB.Message({
          header: { stamp: { secs: 0, nsecs: 0 }, frame_id: '' },
          axes: next.axes,
          buttons: next.buttons.map(value => (value > 0.5 ? 1 : 0)),
        })
      );
    },
    [isEditing]
  );

  const runOperation = useCallback(
    (controlId: PhysicalGamepadControlId, event: 'press' | 'release') => {
      const operation = bindings?.[controlId]?.[event];
      const key = `${controlId}:${event}`;
      if (!operation || isEditing || operationControllersRef.current.has(key)) return;
      const controller = new AbortController();
      operationControllersRef.current.set(key, controller);
      void executeRosOperation(ros, operation, controller.signal)
        .then(() => setOperationError(''))
        .catch(() => {
          if (!controller.signal.aborted) setOperationError(`${controlId} ${event} operation failed`);
        })
        .finally(() => operationControllersRef.current.delete(key));
    },
    [bindings, isEditing, ros]
  );

  useEffect(() => {
    if (isEditing || !action?.topic || !action.messageType) return;
    const topic = new ROSLIB.Topic({ ros, name: action.topic, messageType: action.messageType });
    topic.advertise();
    topicRef.current = topic;
    return () => {
      if (connectedRef.current) publishJoy(EMPTY_GAMEPAD_SNAPSHOT);
      topic.unadvertise();
      if (topicRef.current === topic) topicRef.current = null;
    };
  }, [action?.messageType, action?.topic, isEditing, publishJoy, ros]);

  useEffect(() => {
    if (isEditing || typeof navigator.getGamepads !== 'function') return;
    let frameId = 0;
    let stopped = false;

    const disconnect = () => {
      if (!connectedRef.current) return;
      connectedRef.current = false;
      publishJoy(EMPTY_GAMEPAD_SNAPSHOT);
      previousPressedRef.current = Array(17).fill(false);
      snapshotKeyRef.current = '';
      connectionKeyRef.current = '';
      setSnapshot(EMPTY_GAMEPAD_SNAPSHOT);
      setConnection(null);
    };

    const poll = (now: number) => {
      if (stopped) return;
      const gamepad = findPhysicalGamepad(navigator.getGamepads(), config.config?.physicalGamepadIndex);
      if (!gamepad) {
        disconnect();
        frameId = requestAnimationFrame(poll);
        return;
      }

      const next = snapshotPhysicalGamepad(gamepad, config.config?.physicalGamepadDeadzone);
      const nextKey = physicalGamepadSnapshotKey(next);
      const changed = nextKey !== snapshotKeyRef.current;
      const justConnected = !connectedRef.current;
      connectedRef.current = true;
      const connectionKey = `${gamepad.index}:${gamepad.id}:${gamepad.mapping}`;
      if (connectionKeyRef.current !== connectionKey) {
        connectionKeyRef.current = connectionKey;
        setConnection({ id: gamepad.id, index: gamepad.index, mapping: gamepad.mapping });
      }

      PHYSICAL_GAMEPAD_CONTROLS.forEach(({ id, buttonIndex }) => {
        const wasPressed = previousPressedRef.current[buttonIndex] ?? false;
        const isPressed = next.pressed[buttonIndex] ?? false;
        if (isPressed !== wasPressed) runOperation(id, isPressed ? 'press' : 'release');
      });
      previousPressedRef.current = next.pressed;

      if (changed) {
        snapshotKeyRef.current = nextKey;
        setSnapshot(next);
      }
      if (changed || justConnected || now - lastPublishedAtRef.current >= JOY_PUBLISH_INTERVAL_MS) {
        publishJoy(next);
        lastPublishedAtRef.current = now;
      }
      frameId = requestAnimationFrame(poll);
    };

    frameId = requestAnimationFrame(poll);
    return () => {
      stopped = true;
      cancelAnimationFrame(frameId);
      disconnect();
    };
  }, [
    config.config?.physicalGamepadDeadzone,
    config.config?.physicalGamepadIndex,
    isEditing,
    publishJoy,
    runOperation,
  ]);

  useEffect(
    () => () => {
      operationControllersRef.current.forEach(controller => controller.abort());
      operationControllersRef.current.clear();
    },
    []
  );

  const label = useCallback((id: PhysicalGamepadControlId) => getPhysicalGamepadControlLabel(id, profile), [profile]);
  const active = useCallback(
    (id: PhysicalGamepadControlId) => {
      const index = PHYSICAL_GAMEPAD_CONTROLS.find(control => control.id === id)?.buttonIndex ?? -1;
      return snapshot.pressed[index] || snapshot.buttons[index] > 0.05;
    },
    [snapshot]
  );
  const stickLayout = profile === 'playstation' ? 'symmetric' : 'offset';
  const leftStick = useMemo(() => ({ x: snapshot.axes[0] * 10, y: snapshot.axes[1] * 10 }), [snapshot.axes]);
  const rightStick = useMemo(() => ({ x: snapshot.axes[2] * 10, y: snapshot.axes[3] * 10 }), [snapshot.axes]);

  const controlClass = (id: PhysicalGamepadControlId) => `physical-control ${active(id) ? 'is-active' : ''}`;

  return (
    <div className={`physical-gamepad physical-gamepad-${profile}`}>
      <div className="physical-gamepad-status" role="status">
        <span className={`physical-gamepad-dot ${connection ? 'connected' : ''}`} />
        {isEditing
          ? `${profile} preview`
          : connection
            ? `#${connection.index} ${connection.id}`
            : 'Press a controller button to connect'}
      </div>
      <svg viewBox="0 0 400 250" role="img" aria-label={`${profile} gamepad visualization`}>
        <path
          className="physical-gamepad-body"
          d="M108 45 C55 42 28 83 22 157 C18 211 43 235 72 210 L116 171 H284 L328 210 C357 235 382 211 378 157 C372 83 345 42 292 45 Z"
        />
        <g className={controlClass('left-trigger')}>
          <rect x="79" y="28" width="55" height="20" rx="8" />
          <text x="106" y="42">
            {label('left-trigger')}
          </text>
        </g>
        <g className={controlClass('right-trigger')}>
          <rect x="266" y="28" width="55" height="20" rx="8" />
          <text x="294" y="42">
            {label('right-trigger')}
          </text>
        </g>
        <g className={controlClass('left-bumper')}>
          <rect x="68" y="48" width="72" height="18" rx="7" />
          <text x="104" y="61">
            {label('left-bumper')}
          </text>
        </g>
        <g className={controlClass('right-bumper')}>
          <rect x="260" y="48" width="72" height="18" rx="7" />
          <text x="296" y="61">
            {label('right-bumper')}
          </text>
        </g>

        <g
          transform={stickLayout === 'symmetric' ? 'translate(138 171)' : 'translate(115 113)'}
          className={controlClass('left-stick')}
        >
          <circle className="stick-well" r="30" />
          <circle className="stick-knob" r="20" transform={`translate(${leftStick.x} ${leftStick.y})`} />
          <text y="5">{label('left-stick')}</text>
        </g>
        <g
          transform={stickLayout === 'symmetric' ? 'translate(262 171)' : 'translate(245 169)'}
          className={controlClass('right-stick')}
        >
          <circle className="stick-well" r="30" />
          <circle className="stick-knob" r="20" transform={`translate(${rightStick.x} ${rightStick.y})`} />
          <text y="5">{label('right-stick')}</text>
        </g>

        <g
          transform={stickLayout === 'symmetric' ? 'translate(82 112)' : 'translate(138 171)'}
          className="physical-dpad"
        >
          <path className={controlClass('dpad-up')} d="M-13 -34 H13 V-9 H-13 Z" />
          <path className={controlClass('dpad-down')} d="M-13 9 H13 V34 H-13 Z" />
          <path className={controlClass('dpad-left')} d="M-34 -13 H-9 V13 H-34 Z" />
          <path className={controlClass('dpad-right')} d="M9 -13 H34 V13 H9 Z" />
          <rect x="-13" y="-13" width="26" height="26" />
        </g>

        <g className="physical-face-buttons" transform="translate(305 111)">
          <g transform="translate(0 31)" className={controlClass('face-bottom')}>
            <circle r="17" />
            <text y="5">{label('face-bottom')}</text>
          </g>
          <g transform="translate(31 0)" className={controlClass('face-right')}>
            <circle r="17" />
            <text y="5">{label('face-right')}</text>
          </g>
          <g transform="translate(-31 0)" className={controlClass('face-left')}>
            <circle r="17" />
            <text y="5">{label('face-left')}</text>
          </g>
          <g transform="translate(0 -31)" className={controlClass('face-top')}>
            <circle r="17" />
            <text y="5">{label('face-top')}</text>
          </g>
        </g>

        <g className={controlClass('select')}>
          <rect x="163" y="103" width="27" height="15" rx="7" />
          <text x="176.5" y="114">
            {label('select')}
          </text>
        </g>
        <g className={controlClass('start')}>
          <rect x="210" y="103" width="27" height="15" rx="7" />
          <text x="223.5" y="114">
            {label('start')}
          </text>
        </g>
        <g className={controlClass('home')}>
          <circle cx="200" cy="82" r="14" />
          <text x="200" y="86">
            {label('home')}
          </text>
        </g>
      </svg>
      {connection && connection.mapping !== 'standard' && (
        <small className="physical-gamepad-warning">
          Non-standard browser mapping; verify control indices before driving.
        </small>
      )}
      {operationError && (
        <small className="physical-gamepad-warning" role="alert">
          {operationError}
        </small>
      )}
    </div>
  );
};

export default PhysicalGamepadComponent;
