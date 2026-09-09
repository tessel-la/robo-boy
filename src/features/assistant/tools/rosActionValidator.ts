import type { ROSDiscoveryResult } from '../../behaviorTree/types';
import type { RosOperation } from '../../../utils/rosOperations';

export interface RosActionValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Existence + top-level message-type check for one proposed ROS action, run against the same
 * discovery snapshot the assistant already has cached — before the "Run" button is ever enabled.
 * This catches a hallucinated topic/service/action name or a wrong message type; it does not
 * (yet) diff the payload's fields against the message's full schema — the model receives the
 * exact schema for BT-tool turns (`fetchBehaviorTreeSchemas`) but a standalone `rosAction`
 * proposal only gets this name/type check because chat renders it for review and never executes it.
 * Documented as a known limitation, not silently assumed complete.
 */
export const validateRosActionProposal = (
  operation: RosOperation,
  discovery: ROSDiscoveryResult
): RosActionValidationIssue[] => {
  const issues: RosActionValidationIssue[] = [];
  const lookup =
    operation.kind === 'topic' ? discovery.topics : operation.kind === 'service' ? discovery.services : discovery.actions;
  const match = lookup.find(resource => resource.name === operation.name);

  if (!match) {
    issues.push({
      severity: 'error',
      message: `"${operation.name}" is not currently visible on the connected robot (checked against the ${operation.kind === 'topic' ? 'topic' : operation.kind === 'service' ? 'service' : 'action'} list).`,
    });
  } else if (match.type !== operation.messageType) {
    issues.push({
      severity: 'error',
      message: `Expected type "${operation.messageType}" but the robot reports "${match.type}" for "${operation.name}".`,
    });
  }

  return issues;
};
