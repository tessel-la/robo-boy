import type { Ros } from 'roslib';
import { parseGeneratedAgentResponse } from '../../behaviorTree/agent/treeGeneration';
import { fetchActionGoalDetails, fetchServiceRequestSchema } from '../../behaviorTree/services/rosDiscovery';
import type { BehaviorTreeResourceSchemas } from '../../behaviorTree/agent/types';
import type { ROSDiscoveryResult } from '../../behaviorTree/types';
import type { AssistantResponse } from '../types';

/**
 * Per-type action/service parameter schemas for whichever types the current discovery result
 * contains. Only called when a turn actually needs the BT tool (plan §3.12's "needs" gating) —
 * the sequential-fetch discipline (never `Promise.all`) matches `discoverAllROSResources`'s own
 * documented reason: concurrent rosbridge service calls have caused disconnects on large graphs.
 */
export const fetchBehaviorTreeSchemas = async (
  ros: Ros,
  discovery: ROSDiscoveryResult
): Promise<BehaviorTreeResourceSchemas> => {
  const schemas: BehaviorTreeResourceSchemas = { actions: {}, services: {} };
  for (const actionType of Array.from(new Set(discovery.actions.map(action => action.type).filter(Boolean)))) {
    const details = await fetchActionGoalDetails(ros, actionType);
    if (details) schemas.actions[actionType] = details;
  }
  for (const serviceType of Array.from(new Set(discovery.services.map(service => service.type).filter(Boolean)))) {
    const details = await fetchServiceRequestSchema(ros, serviceType);
    if (details) schemas.services[serviceType] = details;
  }
  return schemas;
};

// treeGeneration.ts's parse/repair logic (`normalizeTree`, `parseGeneratedBehaviorTree`,
// `parseGeneratedAgentResponse`) is kept exactly as-is — it is well-tested, BT-chat-UI-independent
// LLM-output validation. Only this adapter is new: it maps its `{kind:'tree', tree}` output onto
// this module's generalized `AssistantResponse` union.
export { parseGeneratedBehaviorTree } from '../../behaviorTree/agent/treeGeneration';

export const BEHAVIOR_TREE_PROMPT_FRAGMENT = `## Behavior Tree tool
When the user asks to create, change, fix, or extend a behavior tree, act autonomously and return ONLY one finished tree JSON object with this shape:
{"kind":"tree","name":"tree name","description":"short purpose","blackboardDefaults":{},"nodes":[{"id":"unique-id","type":"sequence|selector|parallel|retry|repeat|timeout|ifElse|action|service|topic|subscriber|subtree","label":"visible label","config":{},"tree":{...only for subtree}}],"edges":[{"source":"parent-id","target":"child-id","sourceHandle":"then|else only for ifElse"}]}
Action config: {"actionName":"/name","actionType":"pkg/action/Type","parameters":{},"timeout":number,"inputBindings":[{"variable":"name","targetPath":"field.path"}],"outputBindings":[{"sourcePath":"field.path","variable":"name"}]}.
Service config: {"serviceName":"/name","serviceType":"pkg/srv/Type","request":{},"timeout":number,"inputBindings":[],"outputBindings":[]}.
Publisher topic config: {"topicName":"/name","messageType":"pkg/msg/Type","message":{},"publishOnce":true,"frequencyHz":number,"durationMs":number,"inputBindings":[]}.
Subscriber config: {"topicName":"/name","messageType":"pkg/msg/Type","timeout":10000,"outputBindings":[{"sourcePath":"field.path","variable":"name"}]}.
Timeout config: {"timeout":10000}. If/else config: {"variable":"blackboardName","operator":"truthy|falsy|equals|notEquals|greaterThan|greaterThanOrEqual|lessThan|lessThanOrEqual|exists","expectedValue":any}; connect its branches with sourceHandle "then" and "else".
Retry/repeat config: {"iterationLimit":3}. A subtree node must contain a complete nested tree object in "tree".
Edges are directed parent-to-child. Every non-root node should have one parent. Child edge array order is execution order. Use only resources supplied in context unless the user explicitly asks for placeholders.
For every action and service, fill the complete parameters/request object from its supplied schema and defaults. Movement values such as x, y, z, yaw, distance, displacement, frame, and relative mode must reflect the user's request; do not silently omit them.
Use blackboardDefaults and bindings when data must flow between subscriber, action, service, publisher, or if/else nodes. Do not invent bindings when static values are sufficient.
Map forward/backward to x and left/right to y using the robot context; when none is supplied, use ROS convention (+x forward, +y left, +z up). Treat a requested displacement as relative motion, set unspecified displacement axes to 0, preserve/current-or-default yaw when unspecified, and use every remaining schema default. Infer retries, timeout, tolerances, and optional values from context or safe defaults, and put important assumptions in the tree description so the user can inspect them.`;

/** Parses a raw model response for a turn where the BT tool was offered, adapting
 * treeGeneration's `{kind:'tree', tree}` onto this module's `AssistantResponse` union. */
export const parseBehaviorTreeToolResponse = (
  text: string,
  schemas: BehaviorTreeResourceSchemas
): AssistantResponse => {
  const parsed = parseGeneratedAgentResponse(text, schemas);
  if (parsed.kind === 'tree') return { kind: 'behaviorTree', tree: parsed.tree };
  if (parsed.kind === 'clarification') return { kind: 'clarification', question: parsed.question, suggestions: parsed.suggestions };
  return { kind: 'explanation', message: parsed.message };
};
