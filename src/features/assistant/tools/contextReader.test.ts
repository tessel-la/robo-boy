import { beforeEach, describe, expect, it, vi } from 'vitest';
const reads = vi.hoisted(() => ({ sampleRosTopic: vi.fn(), fetchRosNodeNames: vi.fn(), fetchRosParameterNames: vi.fn(), fetchRosNodeDetails: vi.fn(), fetchRosParameterValue: vi.fn(), captureRosout: vi.fn() }));
const schemas = vi.hoisted(() => ({ fetchMessageSchema: vi.fn(), fetchServiceRequestSchema: vi.fn(), fetchActionGoalDetails: vi.fn(), resolveResourceType: vi.fn() }));
const tf = vi.hoisted(() => ({ captureTfSnapshotOnDemand: vi.fn(), lookupTransformOnDemand: vi.fn() }));
const camera = vi.hoisted(() => ({ captureCameraFrame: vi.fn() }));
const pad = vi.hoisted(() => ({ readPadValues: vi.fn() }));
vi.mock('../context/rosContext', () => reads);
vi.mock('../../behaviorTree/services/rosDiscovery', () => schemas);
vi.mock('../context/tfContext', () => tf);
vi.mock('../context/cameraContext', () => camera);
vi.mock('../context/padContext', () => pad);
import { readAssistantContext } from './contextReader';

const ros = {} as never;
const graph = { topics: [{ name: '/joint_states', type: 'sensor_msgs/msg/JointState' }], services: [{ name: '/reset', type: 'std_srvs/srv/Trigger' }], actions: [{ name: '/home', type: 'control_msgs/action/FollowJointTrajectory', namespace: '/' }] };
const context = () => ({ ros, graph, signal: new AbortController().signal, workspace: () => ({ selectedPad: 'pad1' }), refreshGraph: vi.fn(async () => graph), pads: [{ id: 'pad1', name: 'Arm Pad', components: [] }] as never, imageCount: 0 });

describe('assistant read tools', () => {
  beforeEach(() => vi.resetAllMocks());
  it('samples only the discovered name and authoritative message type, with cancellation and a one-message bound', async () => {
    const sample = { samples: [{ receivedAt: 123, value: { name: ['joint1'], position: [0.25] } }] };
    reads.sampleRosTopic.mockResolvedValue(sample);
    const input = context();
    expect(await readAssistantContext({ kind: 'topic', name: '/joint_states' }, input)).toEqual({ value: sample });
    expect(reads.sampleRosTopic).toHaveBeenCalledWith(ros, '/joint_states', 'sensor_msgs/msg/JointState', { maxMessages: 1, signal: input.signal });
    await expect(readAssistantContext({ kind: 'topic', name: '/invented' }, input)).rejects.toThrow('Unknown topic');
    expect(reads.sampleRosTopic).toHaveBeenCalledOnce();
  });
  it('retrieves topic, service and action definitions by discovered type, including empty service requests', async () => {
    const details = { fields: [], defaults: {} };
    Object.values(schemas).forEach(fn => fn.mockResolvedValue(details));
    for (const [resource, name, type, fetch] of [
      ['topic', '/joint_states', 'sensor_msgs/msg/JointState', schemas.fetchMessageSchema],
      ['service', '/reset', 'std_srvs/srv/Trigger', schemas.fetchServiceRequestSchema],
      ['action', '/home', 'control_msgs/action/FollowJointTrajectory', schemas.fetchActionGoalDetails],
    ] as const) {
      const input = context();
      expect(await readAssistantContext({ kind: 'schema', resource, name }, input)).toEqual({ value: { resource, name, messageType: type, schema: details } });
      expect(fetch).toHaveBeenCalledWith(ros, type, input.signal);
    }
    schemas.fetchActionGoalDetails.mockResolvedValue(null);
    await expect(readAssistantContext({ kind: 'schema', resource: 'action', name: '/home' }, context())).rejects.toThrow('No action schema');
  });
  it('resolves one unknown interface type before retrieving its schema, without guessing', async () => {
    const input = context();
    input.graph = { ...graph, services: [{ name: '/reset', type: 'unknown' }] };
    schemas.resolveResourceType.mockResolvedValue('std_srvs/srv/Trigger');
    schemas.fetchServiceRequestSchema.mockResolvedValue({ fields: [], defaults: {} });
    expect((await readAssistantContext({ kind: 'schema', resource: 'service', name: '/reset' }, input)).value).toMatchObject({ messageType: 'std_srvs/srv/Trigger' });
    expect(schemas.resolveResourceType).toHaveBeenCalledWith(ros, 'service', '/reset', input.signal);
    expect(input.graph.services[0].type).toBe('std_srvs/srv/Trigger');
    input.graph.services[0].type = 'unknown'; schemas.resolveResourceType.mockResolvedValue(null);
    await expect(readAssistantContext({ kind: 'schema', resource: 'service', name: '/reset' }, input)).rejects.toThrow(/No schema was guessed/);
  });
  it('permits local workspace reads while disconnected and rejects robot reads or cancelled work', async () => {
    const input = { ...context(), ros: null };
    expect(await readAssistantContext({ kind: 'workspace' }, input)).toEqual({ value: { selectedPad: 'pad1' } });
    await expect(readAssistantContext({ kind: 'parameter', name: '/speed' }, input)).rejects.toThrow('disconnected');
    await expect(readAssistantContext({ kind: 'workspace' }, { ...input, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('reads catalogue, node details and parameter values without any operation execution', async () => {
    reads.fetchRosNodeNames.mockResolvedValue(['/arm']); reads.fetchRosParameterNames.mockResolvedValue(['/speed']);
    reads.fetchRosNodeDetails.mockResolvedValue({ publishers: ['/joint_states'] }); reads.fetchRosParameterValue.mockResolvedValue(0.5);
    const input = context();
    expect((await readAssistantContext({ kind: 'catalog' }, input)).value).toEqual({ nodes: ['/arm'], parameters: ['/speed'] });
    expect((await readAssistantContext({ kind: 'node', name: '/arm' }, input)).value).toEqual({ publishers: ['/joint_states'] });
    expect((await readAssistantContext({ kind: 'parameter', name: '/speed' }, input)).value).toBe(0.5);
    expect(reads.fetchRosParameterValue).toHaveBeenCalledWith(ros, '/speed', input.signal);
    expect((await readAssistantContext({ kind: 'graph' }, input)).value).toMatchObject({ ...graph, totals: { topics: 1, services: 1, actions: 1 }, limit: 100 });
    expect(input.refreshGraph).toHaveBeenCalledOnce();
  });
  it('returns calculated transforms and logs and propagates retrieval failures to the loop', async () => {
    tf.captureTfSnapshotOnDemand.mockResolvedValue({ frames: ['map', 'arm'] }); tf.lookupTransformOnDemand.mockResolvedValue({ translation: [1, 0, 0] }); reads.sampleRosTopic.mockResolvedValue({ samples: [{ value: 'warning' }] });
    const input = context();
    expect((await readAssistantContext({ kind: 'tf' }, input)).value).toEqual({ frames: ['map', 'arm'] });
    expect((await readAssistantContext({ kind: 'transform', sourceFrame: 'map', targetFrame: 'arm' }, input)).value).toEqual({ translation: [1, 0, 0] });
    expect(tf.lookupTransformOnDemand).toHaveBeenCalledWith(ros, 'map', 'arm', 4000, input.signal);
    expect((await readAssistantContext({ kind: 'rosout' }, input)).value).toEqual({ samples: [{ value: 'warning' }] });
    reads.sampleRosTopic.mockRejectedValue(new Error('No logs arrived'));
    await expect(readAssistantContext({ kind: 'rosout' }, input)).rejects.toThrow('No logs arrived');
  });
  it('resolves saved Pad values without allowing invented Pad ids', async () => {
    pad.readPadValues.mockResolvedValue({ value: 5 });
    expect((await readAssistantContext({ kind: 'padValues', name: 'Arm Pad' }, context())).value).toEqual({ value: 5 });
    await expect(readAssistantContext({ kind: 'padValues', name: 'missing' }, context())).rejects.toThrow('Unknown Pad');
    expect(pad.readPadValues).toHaveBeenCalledOnce();
  });
  it('uses the displayed recording for camera reads even without a live robot, keeping image bytes out of observations', async () => {
    const recording = { getTopics: vi.fn(success => success({ topics: ['/image'], types: ['sensor_msgs/msg/Image'] })) } as never;
    const image = { topic: '/image', mimeType: 'image/jpeg', data: 'cGljdHVyZQ==', width: 10, height: 10 };
    camera.captureCameraFrame.mockResolvedValue(image);
    const input = { ...context(), ros: null, displayRos: recording };
    const result = await readAssistantContext({ kind: 'camera', name: '/image' }, input);
    expect(result.image).toEqual(image);
    expect(result.value).toMatchObject({ imageAttached: true, topic: '/image' });
    expect(result.value).not.toHaveProperty('data');
    expect(camera.captureCameraFrame).toHaveBeenCalledWith(recording, { name: '/image', type: 'sensor_msgs/msg/Image' }, { signal: input.signal });
    await expect(readAssistantContext({ kind: 'camera', name: '/image' }, { ...input, imageCount: 6 })).rejects.toThrow('six images');
    await expect(readAssistantContext({ kind: 'camera', name: '/invented' }, input)).rejects.toThrow('Unknown camera');
    await expect(readAssistantContext({ kind: 'camera', name: '/image' }, { ...input, displayRos: null })).rejects.toThrow('No live camera');
  });
});
