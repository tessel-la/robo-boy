import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeRosOperationMock = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/rosOperations', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../utils/rosOperations')>();
  return { ...actual, executeRosOperation: executeRosOperationMock };
});

import { executeGuardedRosAction, RosActionRejectedError } from './rosActionGuard';

describe('executeGuardedRosAction', () => {
  beforeEach(() => {
    executeRosOperationMock.mockReset();
  });

  it('executes via the existing executeRosOperation when the generation is unchanged', async () => {
    executeRosOperationMock.mockResolvedValue({ ok: true });
    const result = await executeGuardedRosAction({
      ros: {} as any,
      operation: { kind: 'topic', name: '/cmd_vel', messageType: 'geometry_msgs/Twist', payload: { linear: { x: 1 } } },
      proposedAtGeneration: 3,
      getCurrentGeneration: () => 3,
    });
    expect(result).toEqual({ ok: true });
    expect(executeRosOperationMock).toHaveBeenCalledOnce();
  });

  it('rejects before executing if the connection has already reconnected (generation changed)', async () => {
    await expect(
      executeGuardedRosAction({
        ros: {} as any,
        operation: { kind: 'topic', name: '/cmd_vel', messageType: 'geometry_msgs/Twist' },
        proposedAtGeneration: 3,
        getCurrentGeneration: () => 4,
      })
    ).rejects.toBeInstanceOf(RosActionRejectedError);
    expect(executeRosOperationMock).not.toHaveBeenCalled();
  });

  it('flags a result as suspect if the connection changed while the call was in flight', async () => {
    let currentGeneration = 3;
    executeRosOperationMock.mockImplementation(async () => {
      currentGeneration = 4; // reconnect happens mid-call
      return { ok: true };
    });
    await expect(
      executeGuardedRosAction({
        ros: {} as any,
        operation: { kind: 'service', name: '/set_bool', messageType: 'std_srvs/srv/SetBool' },
        proposedAtGeneration: 3,
        getCurrentGeneration: () => currentGeneration,
      })
    ).rejects.toBeInstanceOf(RosActionRejectedError);
  });

  it('rejects a non-object payload', async () => {
    await expect(
      executeGuardedRosAction({
        ros: {} as any,
        operation: { kind: 'topic', name: '/cmd_vel', messageType: 'geometry_msgs/Twist', payload: 'not-an-object' as any },
        proposedAtGeneration: 1,
        getCurrentGeneration: () => 1,
      })
    ).rejects.toThrow(/JSON object/);
    expect(executeRosOperationMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized payload', async () => {
    const bigString = 'x'.repeat(1024 * 1024 + 10);
    await expect(
      executeGuardedRosAction({
        ros: {} as any,
        operation: { kind: 'topic', name: '/cmd_vel', messageType: 'geometry_msgs/Twist', payload: { data: bigString } },
        proposedAtGeneration: 1,
        getCurrentGeneration: () => 1,
      })
    ).rejects.toThrow(/byte limit/);
    expect(executeRosOperationMock).not.toHaveBeenCalled();
  });
});
