// The fields of a message type, for the settings of any component that reads or writes one: asked of rosapi while
// ROS is connected, taken from the built-in list of common types otherwise.
import { useEffect, useState } from 'react';
import type { Ros } from 'roslib';
import { commonFields, fetchMessageFields, type FieldKind, type MessageFieldOption } from './rosMessageUtils';

export interface MessageFields {
  fields: MessageFieldOption[];
  isLoading: boolean;
  /** The message type the fields are of (the one asked for, once they have arrived). */
  messageType: string;
}

/** A type being typed is looked up once the typing pauses, not at every keystroke. */
const LOOKUP_DELAY_MS = 300;

export function useMessageFields(ros: Ros | null | undefined, messageType: string, enabled = true): MessageFields {
  const type = messageType.trim();
  const isConnected = Boolean(ros?.isConnected);
  const [state, setState] = useState<MessageFields>({ fields: [], isLoading: false, messageType: '' });

  useEffect(() => {
    if (!enabled || !type) {
      setState({ fields: [], isLoading: false, messageType: type });
      return;
    }
    if (!ros || !isConnected) {
      setState({ fields: commonFields(type), isLoading: false, messageType: type });
      return;
    }
    let cancelled = false;
    setState(previous => ({ ...previous, isLoading: true }));
    const timer = setTimeout(() => {
      fetchMessageFields(ros, type).then(fields => {
        if (!cancelled) setState({ fields, isLoading: false, messageType: type });
      });
    }, LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, isConnected, ros, type]);

  return state;
}

/**
 * The field to switch to after the message type changed: the current one if the new type still has it (or nothing is
 * known of the new type), otherwise its first field of a kind the component can use.
 */
export function fieldForNewType(fields: readonly MessageFieldOption[], current: string, kinds: readonly FieldKind[]): string {
  if (fields.length === 0 || fields.some(field => field.path === current && kinds.includes(field.kind))) return current;
  return fields.find(field => kinds.includes(field.kind))?.path ?? current;
}
