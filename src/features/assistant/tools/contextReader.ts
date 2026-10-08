import type { Ros } from 'roslib';
import type { ROSDiscoveryResult } from '../../behaviorTree/types';
import type { CustomGamepadLayout } from '../../customGamepad/types';
import { fetchActionGoalDetails, fetchMessageSchema, fetchServiceRequestSchema, resolveResourceType } from '../../behaviorTree/services/rosDiscovery';
import { fetchRosNodeDetails, fetchRosNodeNames, fetchRosParameterNames, fetchRosParameterValue, sampleRosTopic } from '../context/rosContext';
import { captureTfSnapshotOnDemand, lookupTransformOnDemand } from '../context/tfContext';
import { captureCameraFrame, type CameraFrame } from '../context/cameraContext';
import { readPadValues } from '../context/padContext';
import type { ContextRead } from './contextTool';
import { runSerializedRosapi } from '../../../utils/rosapiQueue';

/** Read-only dispatcher. Resource names are resolved against the supplied graph, so the model
 * cannot cause arbitrary topic/schema probes. Subscription and rosapi helpers own cleanup. */
export async function readAssistantContext(read: ContextRead, context: {
  ros: Ros | null;
  displayRos?: Ros | null;
  signal: AbortSignal;
  graph: ROSDiscoveryResult | null;
  workspace(): unknown;
  refreshGraph(): Promise<ROSDiscoveryResult | null>;
  pads: CustomGamepadLayout[];
  imageCount: number;
}): Promise<{ value: unknown; image?: CameraFrame }> {
  const { ros, signal, graph } = context;
  signal.throwIfAborted();
  if (read.kind === 'workspace') {
    const value = context.workspace() as Record<string, any>;
    const workspace = value?.workspace;
    return { value: {
      ...value,
      ...(Array.isArray(value?.padLibrary) ? { padLibrary: value.padLibrary.map(({ id, name, isDefault }: { id: string; name: string; isDefault: boolean }) => ({ id, name, isDefault })) } : {}),
      ...(Array.isArray(value?.behaviorTreeLibrary) ? { behaviorTreeLibrary: value.behaviorTreeLibrary.map(({ id, name }: { id: string; name: string }) => ({ id, name })) } : {}),
      ...(workspace && read.panelId ? { workspace: { ...workspace, openPanels: workspace.openPanels.filter((panel: { id: string }) => panel.id === read.panelId) } } : {}),
    } };
  }
  if (read.kind === 'camera') {
    if (context.imageCount >= 6) throw new Error('This turn already has six images. Use the attached frames or request another capture in a follow-up.');
    const source = context.displayRos ?? ros;
    if (!source) throw new Error('No live camera or recording is available.');
    const topics = source === ros ? graph?.topics ?? [] : await runSerializedRosapi(source, () => new Promise<Array<{ name: string; type: string }>>((resolve, reject) => {
      source.getTopics(result => resolve(result.topics.map((name, index) => ({ name, type: result.types[index] }))), reject);
    }), signal);
    const topic = topics.find(item => item.name === read.name);
    if (!topic) throw new Error(`Unknown camera topic "${read.name}" on the displayed source.`);
    const image = await captureCameraFrame(source, topic, { signal });
    return { image, value: { topic: image.topic, width: image.width, height: image.height, capturedAt: Date.now(), imageAttached: true } };
  }
  if (!ros) throw new Error('ROS is disconnected. Connect before reading live robot data.');
  switch (read.kind) {
    case 'graph': {
      const result = await context.refreshGraph();
      const filter = (resources: Array<{ name: string; type: string }>) => resources.filter(item => !read.query || `${item.name} ${item.type}`.toLowerCase().includes(read.query.toLowerCase()));
      const topics = filter(result?.topics ?? []), services = filter(result?.services ?? []), actions = filter(result?.actions ?? []);
      const offset = read.offset ?? 0, limit = read.limit ?? 100;
      return { value: { topics: topics.slice(offset, offset + limit), services: services.slice(offset, offset + limit), actions: actions.slice(offset, offset + limit), totals: { topics: topics.length, services: services.length, actions: actions.length }, offset, limit } };
    }
    case 'catalog': return { value: { nodes: await fetchRosNodeNames(ros, signal), parameters: await fetchRosParameterNames(ros, signal) } };
    case 'tf': return { value: await captureTfSnapshotOnDemand(ros, 1800, signal) };
    case 'rosout': {
      const result = await sampleRosTopic(ros, '/rosout', graph?.topics.find(topic => topic.name === '/rosout')?.type ?? 'rcl_interfaces/msg/Log', { maxMessages: read.maxMessages ?? 40, timeoutMs: 4000, signal });
      return { value: { ...result, samples: result.samples.filter(sample => !read.match || JSON.stringify(sample.value).toLowerCase().includes(read.match.toLowerCase())), ...(read.match ? { match: read.match } : {}) } };
    }
    case 'transform': return { value: await lookupTransformOnDemand(ros, read.sourceFrame, read.targetFrame, 4000, signal) };
    case 'node': return { value: await fetchRosNodeDetails(ros, read.name, signal) };
    case 'parameter': return { value: await fetchRosParameterValue(ros, read.name, signal) };
    case 'padValues': {
      const pad = context.pads.find(item => item.id === read.name || item.name === read.name);
      if (!pad) throw new Error(`Unknown Pad "${read.name}". Use an id from the Pad library.`);
      return { value: await readPadValues(ros, pad, signal) };
    }
  }
  if (!('name' in read)) throw new Error('This read requires a resource name.');
  const kind = read.kind === 'schema' ? read.resource : 'topic';
  const resources = kind === 'topic' ? graph?.topics : kind === 'service' ? graph?.services : graph?.actions;
  const resource = resources?.find(item => item.name === read.name);
  if (!resource) throw new Error(`Unknown ${kind} "${read.name}". Read graph to discover available names.`);
  if (!resource.type || resource.type === 'unknown') {
    const type = await resolveResourceType(ros, kind, resource.name, signal);
    signal.throwIfAborted();
    if (!type || type === 'unknown') throw new Error(`The robot did not resolve the ${kind} type for "${resource.name}". No schema was guessed.`);
    resource.type = type;
  }
  if (read.kind === 'topic') return { value: await sampleRosTopic(ros, resource.name, resource.type, { maxMessages: read.maxMessages ?? 1, timeoutMs: read.timeoutMs, signal }) };
  const schema = kind === 'topic' ? await fetchMessageSchema(ros, resource.type, signal)
    : kind === 'service' ? await fetchServiceRequestSchema(ros, resource.type, signal)
    : await fetchActionGoalDetails(ros, resource.type, signal);
  if (!schema) throw new Error(`No ${kind} schema was returned for "${resource.name}".`);
  return { value: { resource: kind, name: resource.name, messageType: resource.type, schema } };
}
