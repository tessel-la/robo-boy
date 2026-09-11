import type { ROSActionInfo, ROSDiscoveryResult, ROSServiceInfo, ROSTopicInfo } from '../../behaviorTree/types';
import type { CustomGamepadLayout, GamepadComponentConfig } from '../../customGamepad/types';
import type { RosOperation } from '../../../utils/rosOperations';
import type { PadValidationIssue } from '../types';

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
  discovery: ROSDiscoveryResult
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
    if (!name) return;
    const liveType = topicByName.get(name);
    if (liveType === undefined) {
      report(componentId, componentLabel, `${refLabel} references topic "${name}", which the robot is not currently publishing or subscribing to.`);
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
