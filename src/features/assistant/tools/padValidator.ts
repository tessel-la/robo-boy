import type { ROSActionInfo, ROSDiscoveryResult, ROSServiceInfo, ROSTopicInfo } from '../../behaviorTree/types';
import type { CustomGamepadLayout, GamepadComponentConfig } from '../../customGamepad/types';
import type { RosOperation } from '../../../utils/rosOperations';
import type { PadValidationIssue } from '../types';
import type { AssistantAutoContext } from '../types';
import type { ActionGoalDetails } from '../../behaviorTree/services/rosDiscovery';
import { validatePayload } from './payloadValidation';

/**
 * Whole-layout Pad-vs-ROS validator — nothing like this exists in `src/features/customGamepad/`
 * today (validation there is per-component, live, and only while a human edits that one
 * component in `ComponentSettingsModal`). Rather than a per-component-type table, this walks the
 * three places `GamepadComponentConfig` can reference ROS (`action`, `eventOperations`, and
 * `config.physicalGamepadBindings[...].{press,release}`) generically, since every reference is
 * typed as either `ComponentAction` or `RosOperation` regardless of component type.
 *
 * Pure and synchronous by design: the caller is responsible for obtaining a fresh
 * `ROSDiscoveryResult` (via the assistant's cached `rosGraphCache`, or any other source) first —
 * this function never talks to ROS itself, so it stays trivially unit-testable and never becomes
 * a second, uncoordinated caller of rosapi discovery.
 */
export const validatePadAgainstRos = (
  layout: CustomGamepadLayout,
  discovery: ROSDiscoveryResult,
  schemas?: AssistantAutoContext['interfaceSchemas']
): PadValidationIssue[] => {
  const issues: PadValidationIssue[] = [];
  const topicByName = new Map<string, string>(discovery.topics.map((topic: ROSTopicInfo) => [topic.name, topic.type]));
  const serviceByName = new Map<string, string>(
    discovery.services.map((service: ROSServiceInfo) => [service.name, service.type])
  );
  const actionByName = new Map<string, string>(discovery.actions.map((action: ROSActionInfo) => [action.name, action.type]));

  const report = (componentId: string, componentLabel: string, message: string) => {
    issues.push({ componentId, componentLabel, severity: 'error', message });
  };

  const checkTopic = (name: string, messageType: string, componentId: string, componentLabel: string, refLabel: string) => {
    if (!name || !messageType) { report(componentId, componentLabel, `${refLabel} needs both a topic name and message type.`); return; }
    const liveType = topicByName.get(name);
    if (liveType === undefined) {
      report(componentId, componentLabel, `${refLabel} references topic "${name}", which the robot is not currently publishing or subscribing to.`);
    } else if (liveType === 'unknown' || !liveType) {
      report(componentId, componentLabel, `${refLabel}: retrieve the topic schema for "${name}" to resolve its type.`);
    } else if (messageType && liveType !== messageType) {
      report(
        componentId,
        componentLabel,
        `${refLabel} expects message type "${messageType}" on "${name}", but the robot reports "${liveType}".`
      );
    }
  };

  const checkService = (name: string, messageType: string, componentId: string, componentLabel: string, refLabel: string) => {
    if (!name) return;
    const liveType = serviceByName.get(name);
    if (liveType === undefined) {
      report(componentId, componentLabel, `${refLabel} references service "${name}", which is not currently advertised.`);
    } else if (liveType === 'unknown' || !liveType) {
      report(componentId, componentLabel, `${refLabel}: retrieve the service schema for "${name}" to resolve its type.`);
    } else if (messageType && liveType !== messageType) {
      report(
        componentId,
        componentLabel,
        `${refLabel} expects service type "${messageType}" on "${name}", but the robot reports "${liveType}".`
      );
    }
  };

  const checkAction = (name: string, messageType: string, componentId: string, componentLabel: string, refLabel: string) => {
    if (!name) return;
    const liveType = actionByName.get(name);
    if (liveType === undefined) {
      report(componentId, componentLabel, `${refLabel} references action "${name}", which is not currently available.`);
    } else if (messageType && liveType !== messageType) {
      report(
        componentId,
        componentLabel,
        `${refLabel} expects action type "${messageType}" on "${name}", but the robot reports "${liveType}".`
      );
    }
  };

  const checkOperation = (operation: RosOperation | undefined, componentId: string, componentLabel: string, refLabel: string) => {
    if (!operation) return;
    if (!operation.payload || typeof operation.payload !== 'object' || Array.isArray(operation.payload) || (operation.kind === 'action' && Object.keys(operation.payload).length === 0)) {
      report(componentId, componentLabel, `${refLabel} has no complete ${operation.kind === 'action' ? 'goal' : 'payload'} for "${operation.name}".`);
    }
    const rawSchema = operation.kind === 'topic' ? schemas?.topics[operation.messageType] : operation.kind === 'service' ? schemas?.services[operation.messageType] : schemas?.actions[operation.messageType];
    const schema = rawSchema as ActionGoalDetails | undefined;
    if (schema?.fields && operation.payload) {
      validatePayload(operation.payload, schema).forEach(message => report(componentId, componentLabel, `${refLabel}: ${message}`));
    }
    if (schemas && operation.kind !== 'topic' && !schema) {
      report(componentId, componentLabel, `${refLabel}: retrieve the ${operation.kind} schema for "${operation.name}" before proposing its payload.`);
    }
    if (operation.kind === 'action' && /(?:^|\/)FollowJointTrajectory$/.test(operation.messageType)) {
      const trajectory = operation.payload?.trajectory as { joint_names?: unknown; points?: Array<{ positions?: unknown; time_from_start?: { sec?: number; nanosec?: number } }> } | undefined;
      const names = trajectory?.joint_names;
      if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== 'string' || !name) || new Set(names).size !== names.length) report(componentId, componentLabel, `${refLabel}: trajectory requires distinct captured joint_names.`);
      if (!Array.isArray(trajectory?.points) || !trajectory.points.length) report(componentId, componentLabel, `${refLabel}: trajectory requires target points.`);
      else {
        let previousTime = 0;
        for (const point of trajectory.points) {
          if (!Array.isArray(point.positions) || point.positions.length !== (Array.isArray(names) ? names.length : 0) || point.positions.some(value => typeof value !== 'number' || !Number.isFinite(value))) report(componentId, componentLabel, `${refLabel}: every point needs one finite position for each joint.`);
          const seconds = point.time_from_start?.sec ?? 0, nanos = point.time_from_start?.nanosec ?? 0;
          const time = seconds + nanos / 1e9;
          if (!Number.isInteger(seconds) || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9 || !Number.isFinite(time) || time <= previousTime) report(componentId, componentLabel, `${refLabel}: time_from_start must be positive and increasing.`);
          previousTime = time;
        }
      }
    }
    if (operation.kind === 'topic') checkTopic(operation.name, operation.messageType, componentId, componentLabel, refLabel);
    else if (operation.kind === 'service') checkService(operation.name, operation.messageType, componentId, componentLabel, refLabel);
    else checkAction(operation.name, operation.messageType, componentId, componentLabel, refLabel);
  };

  const checkComponent = (component: GamepadComponentConfig) => {
    const label = component.label || component.type;

    if (component.action) {
      const action = component.action;
      if ('topic' in action) {
        checkTopic(action.topic, action.messageType, component.id, label, 'Primary action');
      } else if ('type' in action && (action.type === 'action' || action.type === 'service')) {
        report(component.id, label, 'Service/action bindings must be stored in eventOperations with a complete payload. A primary action alone will not execute.');
        if (action.type === 'service') checkService(action.name, action.messageType, component.id, label, 'Primary action');
        else checkAction(action.name, action.messageType, component.id, label, 'Primary action');
      }
    }

    if (component.eventOperations) {
      (['press', 'release', 'on', 'off'] as const).forEach(key => {
        checkOperation(component.eventOperations?.[key], component.id, label, `"${key}" operation`);
      });
    }

    const bindings = component.config?.physicalGamepadBindings;
    if (bindings) {
      Object.entries(bindings).forEach(([controlId, binding]) => {
        checkOperation(binding?.press, component.id, label, `"${controlId}" press binding`);
        checkOperation(binding?.release, component.id, label, `"${controlId}" release binding`);
      });
    }
  };

  layout.components.forEach(checkComponent);
  return issues;
};

export const summarizePadValidation = (issues: PadValidationIssue[]): string => {
  if (issues.length === 0) return 'Every ROS reference in this Pad matches the connected robot.';
  const errorCount = issues.filter(issue => issue.severity === 'error').length;
  return `${errorCount} reference${errorCount === 1 ? '' : 's'} no longer match${errorCount === 1 ? 'es' : ''} the connected robot.`;
};
