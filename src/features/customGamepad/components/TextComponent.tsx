import React, { useLayoutEffect, useRef } from 'react';
import type { Ros } from 'roslib';
import type { GamepadComponentConfig, ROSTopicConfig } from '../types';
import { describeRawValue, valuePathOf } from '../padValues';
import { DATA_BINDINGS, describeMismatch } from '../dataComponents';
import { staleText, statusMessage, useFieldValue } from '../useTopicSubscription';
import PadValueFrame from './PadValueFrame';

interface TextComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

export const DEFAULT_TEXT_HISTORY = 5;

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The latest text a topic sent (a status line, a log message), or the last few, newest last. */
const TextComponent: React.FC<TextComponentProps> = ({ config, ros, isEditing = false }) => {
  const historyLength = Math.max(1, Math.min(50, Math.round(config.config?.historyLength ?? DEFAULT_TEXT_HISTORY)));
  const action = config.action as ROSTopicConfig | undefined;
  const { status, latest, history, isStale } = useFieldValue(config, ros, isEditing, historyLength);
  // While the pad is edited there is one sample line, shown as a single message.
  const keep = status === 'preview' ? 1 : historyLength;
  const listRef = useRef<HTMLOListElement>(null);
  const label = config.label?.trim();
  const lines = status === 'preview'
    ? [{ raw: 'Latest message', at: Date.now() }]
    : history.filter(sample => sample.raw !== undefined && typeof sample.raw !== 'object');
  const notice = statusMessage(status, action)
    ?? (latest ? describeMismatch(latest.raw, valuePathOf(config), DATA_BINDINGS.text.fieldKinds) : undefined);

  // New lines arrive at the bottom; keep them in view unless the operator has scrolled back.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    if (nearBottom || lines.length <= 1) list.scrollTop = list.scrollHeight;
  }, [history, lines.length]);

  return (
    <PadValueFrame
      kind="text"
      className={keep === 1 ? 'single' : 'log'}
      label={label}
      aside={keep > 1 && lines.length > 0 ? `${lines.length}/${keep}` : undefined}
      notice={notice}
      staleFor={staleText(isStale, latest)}
      data-testid="text-component"
      role="log"
      aria-label={label || 'Text'}
    >
      <ol ref={listRef} className="pad-text-lines">
        {lines.map((line, index) => (
          <li key={`${line.at}-${index}`}>
            {keep > 1 && <time dateTime={new Date(line.at).toISOString()}>{timeOf(line.at)}</time>}
            <span>{describeRawValue(line.raw)}</span>
          </li>
        ))}
      </ol>
    </PadValueFrame>
  );
};

export default TextComponent;
