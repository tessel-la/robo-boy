import type { Ros } from 'roslib';
import { executeRosOperation, type RosOperation } from '../../../utils/rosOperations';

/** Mirrors the external-panel capability broker's payload-size idiom (`capabilityBroker.ts`'s
 * private `requireJsonPayload`, which cannot be imported — it is scoped to the panel-sandbox
 * protocol). Same numeric cap, reimplemented for this different call site. */
const MAX_PAYLOAD_BYTES = 1024 * 1024;

export class RosActionRejectedError extends Error {}

const requireBoundedJsonPayload = (payload: unknown): void => {
  if (payload === undefined) return;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new RosActionRejectedError('The proposed payload must be a JSON object.');
  }
  const byteLength = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (byteLength > MAX_PAYLOAD_BYTES) {
    throw new RosActionRejectedError(
      `The proposed payload is ${byteLength} bytes, over the ${MAX_PAYLOAD_BYTES}-byte limit.`
    );
  }
};

export interface GuardedRosActionRequest {
  ros: Ros;
  operation: RosOperation;
  /** `connectionGeneration` captured when the proposal was made and shown to the user. */
  proposedAtGeneration: number;
  /** Reads the *current* `connectionGeneration` at call time — a function, not a snapshot, so a
   * reconnect that happens between proposal and confirmation (or during the call itself) is
   * caught rather than silently executed against a superseded connection. */
  getCurrentGeneration: () => number;
  signal?: AbortSignal;
}

/**
 * The single, required gate every assistant-proposed publish/service-call/action-goal must pass
 * through before it reaches the robot (plan §3.10). There is deliberately no batching/looping
 * entry point here: the caller (the confirmation UI) invokes this once per explicit user click,
 * which is what keeps "at most one execution per confirmation" true without extra rate-limit
 * bookkeeping. Cancellation is `executeRosOperation`'s existing `AbortSignal` support, unchanged.
 */
export const executeGuardedRosAction = async (request: GuardedRosActionRequest): Promise<unknown> => {
  requireBoundedJsonPayload(request.operation.payload);

  if (request.getCurrentGeneration() !== request.proposedAtGeneration) {
    throw new RosActionRejectedError(
      'The ROS connection changed since this action was proposed. Ask the assistant again for a fresh proposal before running it.'
    );
  }

  const result = await executeRosOperation(request.ros, request.operation, request.signal);

  if (request.getCurrentGeneration() !== request.proposedAtGeneration) {
    throw new RosActionRejectedError(
      'The ROS connection changed while this action was running — its result may not reflect the current robot.'
    );
  }

  return result;
};
