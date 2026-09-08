import { parseBehaviorTreeToolResponse } from './tools/behaviorTreeTool';
import type { AssistantResponse } from './types';
import type { BehaviorTreeResourceSchemas } from '../behaviorTree/agent/types';
import type { CustomGamepadLayout } from '../customGamepad/types';
import type { RosOperation } from '../../utils/rosOperations';

const stripCodeFence = (value: string): string => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  return start >= 0 && end > start ? value.slice(start, end + 1) : value;
};

const isRosOperationShape = (value: unknown): value is RosOperation =>
  Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as RosOperation).name === 'string' &&
      typeof (value as RosOperation).messageType === 'string' &&
      ['topic', 'service', 'action'].includes((value as RosOperation).kind)
  );

/** Parses one raw model turn into the generalized `AssistantResponse` union (plan §3.12). The
 * `tree` kind is delegated to the kept, tested `treeGeneration.ts` parser via the BT tool adapter;
 * every other kind is validated here directly since there is no equivalent legacy module for it. */
export const parseAssistantResponse = (text: string, schemas: BehaviorTreeResourceSchemas): AssistantResponse => {
  const trimmed = stripCodeFence(text);
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw new Error('The model did not return valid JSON. Try again or use a stronger model.');
  }
  if (!value || typeof value !== 'object') throw new Error('The model returned an unexpected response.');

  switch (value.kind) {
    case 'explanation': {
      const message = value.message;
      if (typeof message !== 'string' || !message.trim()) throw new Error('The model returned an empty explanation.');
      return { kind: 'explanation', message: message.trim() };
    }
    case 'clarification': {
      const question = value.question;
      if (typeof question !== 'string' || !question.trim()) {
        throw new Error('The model returned an empty clarification question.');
      }
      return {
        kind: 'clarification',
        question: question.trim(),
        suggestions: Array.isArray(value.suggestions) ? value.suggestions.map(String).slice(0, 4) : undefined,
      };
    }
    case 'tree':
      return parseBehaviorTreeToolResponse(trimmed, schemas);
    case 'padProposal': {
      const layout = value.layout as CustomGamepadLayout | undefined;
      if (!layout || typeof layout !== 'object' || !Array.isArray(layout.components)) {
        throw new Error('The model returned an invalid Pad layout.');
      }
      return { kind: 'padProposal', layout, issues: [] };
    }
    case 'rosAction': {
      const operation = value.operation;
      if (!isRosOperationShape(operation)) throw new Error('The model returned an invalid ROS action proposal.');
      return {
        kind: 'rosAction',
        operation,
        rationale: typeof value.rationale === 'string' ? value.rationale : '',
        issues: [],
      };
    }
    default:
      throw new Error(`The model returned an unrecognized response kind "${String(value.kind)}".`);
  }
};
