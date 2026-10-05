import type { AssistantCapability } from '../capabilities';
import type { Ros } from 'roslib';
import {
  describeRawValue,
  formatValue,
  levelOf,
  matchState,
  readValue,
  toDisplayNumber,
  valuePathOf,
} from '../../customGamepad/padValues';
import type { CustomGamepadLayout, GamepadComponentConfig } from '../../customGamepad/types';
import { sampleRosTopic } from './rosContext';

/*
 * What an open Pad's display widgets show right now. The widgets subscribe to their own topics;
 * here the same topics are read once and formatted with the Pad's own value functions, so the
 * model gets the numbers the operator sees, without reaching into the widgets.
 */

const DISPLAY_TYPES = new Set(['gauge', 'level', 'readout', 'state', 'text', 'plot', 'heartbeat']);
export const MAX_PAD_TOPICS = 8;

export interface PadDisplayBinding {
  component: string;
  label: string;
  type: GamepadComponentConfig['type'];
  topic: string;
  messageType: string;
  fields: string[];
  config: NonNullable<GamepadComponentConfig['config']>;
}

/** A question about what a Pad's widgets read. Editing a Pad ("add a gauge to the pad") is not one. */
export const wantsPadValues = (text: string) =>
  /\bpads?\b|\bgauges?\b|\breadouts?\b|\bdashboard\b|\bwidgets?\b|\blevel bar\b|\bbattery\b|\breadings?\b/i.test(text) &&
  /\bwhat\b|\bhow (?:much|many|high|low|full)\b|\bcurrent(?:ly)?\b|\bright now\b|\bshows?\b|\breads?\b|\bsays?\b|\bstatus\b|\bvalues?\b|\blevel\b/i.test(text) &&
  !/\b(?:add|remove|create|build|make|design|edit|change|repair|fix|move|resize)\b/i.test(text);

/** The display widgets of a Pad and the topic and fields each one shows. */
export function padDisplayBindings(layout: CustomGamepadLayout): PadDisplayBinding[] {
  return layout.components.flatMap(component => {
    const action = component.action;
    if (!DISPLAY_TYPES.has(component.type) || !action || !('topic' in action) || !action.topic) return [];
    const config = component.config ?? {};
    const fields =
      component.type === 'plot'
        ? config.fieldPaths?.length
          ? config.fieldPaths
          : [config.fieldPath ?? valuePathOf(component)]
        : component.type === 'heartbeat'
          ? config.heartbeatFieldPath ? [config.heartbeatFieldPath] : []
          : [valuePathOf(component)];
    return [{
      component: component.id,
      label: component.label || component.id,
      type: component.type,
      topic: action.topic,
      messageType: action.messageType,
      fields,
      config,
    }];
  });
}

/** One display widget's current reading, formatted as the Pad formats it. */
export function describeReading(binding: PadDisplayBinding, message: unknown) {
  const { config } = binding;
  const values = binding.fields.map(field => {
    const raw = field ? readValue(message, field) : message;
    if (binding.type === 'state') {
      const state = matchState(raw, config.stateMappings);
      return { field, raw: describeRawValue(raw), state: state ? `${state.label} (${state.tone})` : 'no mapping matches' };
    }
    if (binding.type === 'text' || binding.type === 'heartbeat') return { field, raw: describeRawValue(raw).slice(0, 400) };
    const shown = toDisplayNumber(raw, config);
    return {
      field,
      shown: shown === null ? describeRawValue(raw) : `${formatValue(shown, config)}${config.unit ? ` ${config.unit}` : ''}`,
      ...(binding.type !== 'plot' && shown !== null && levelOf(shown, config) !== 'normal' ? { level: levelOf(shown, config) } : {}),
    };
  });
  return { widget: binding.label, type: binding.type, topic: binding.topic, values };
}

/**
 * Reads each topic the Pad shows once (at most MAX_PAD_TOPICS) and returns every display widget's
 * reading. A topic that sent nothing in time is reported as such rather than as a zero.
 */
export async function readPadValues(ros: Ros, layout: CustomGamepadLayout, signal?: AbortSignal) {
  const bindings = padDisplayBindings(layout);
  const topics = [...new Map(bindings.map(binding => [binding.topic, binding.messageType])).entries()].slice(0, MAX_PAD_TOPICS);
  const latest = new Map<string, unknown>();
  await Promise.all(topics.map(async ([topic, messageType]) => {
    const result = await sampleRosTopic(ros, topic, messageType, { maxMessages: 1, timeoutMs: 2500, signal }).catch(error => {
      if (signal?.aborted) throw error;
      return null;
    });
    const sample = result?.samples[result.samples.length - 1];
    if (sample) latest.set(topic, sample.value);
  }));
  return {
    pad: layout.name,
    readAt: new Date().toISOString(),
    readings: bindings.map(binding =>
      latest.has(binding.topic)
        ? describeReading(binding, latest.get(binding.topic))
        : { widget: binding.label, type: binding.type, topic: binding.topic, unavailable: topics.some(([topic]) => topic === binding.topic) ? 'No message arrived within 2.5 s.' : 'Not read: too many topics on this Pad.' }
    ),
  };
}

export const PAD_VALUES_CAPABILITY: AssistantCapability = {
  id: 'pad-values',
  summary:
    'When the user asks what an open Pad shows, the app reads the current values of its gauges, levels, readouts, states, text, plots and heartbeats, formatted and scaled as the Pad shows them, with any warning or alarm level.',
  invocations: ['what does the pad show', 'what is the battery level', 'what are the current readings'],
};
