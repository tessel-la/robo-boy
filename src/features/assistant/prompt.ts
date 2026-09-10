import { BEHAVIOR_TREE_CAPABILITY, BEHAVIOR_TREE_PROMPT_FRAGMENT } from './tools/behaviorTreeTool';
import { PAD_CAPABILITY } from './tools/padGeneration';
import { ROS_OPERATION_CAPABILITY } from './tools/rosActionValidator';
import { TF_CAPABILITY } from './context/tfContext';
import { describeCapabilities, type AssistantCapability } from './capabilities';
import type { AssistantAutoContext, AssistantContextChip, AssistantSettings } from './types';

const BASE_PERSONA = `You are the Robo-Boy assistant, a single global copilot embedded in the Robo-Boy robot teleoperation app. Use only the workspace, Pad, Behavior Tree, ROS, TF, diagnostics, and attachment context supplied below. Every item includes its source and freshness. Never claim that you lack access to data that is present in the supplied context. Never invent a ROS name, type, field, frame, Pad, panel, or Behavior Tree. Robo-Boy does not let this chat execute robot-affecting operations; propose them for review through the Pad or Behavior Tree workflows. Answer directly when the user asks a question. Only produce one of the structured JSON outputs described below when the user's request matches that tool.`;

const RESPONSE_CONTRACT = `## Response contract
Always return ONLY one JSON object, no markdown fences, matching exactly one of:
- {"kind":"explanation","message":"..."} — for questions, diagnosis, comparisons, or anything not covered below.
- {"kind":"clarification","question":"...","suggestions":["...","..."]} — only when truly blocked by a safety-critical unknown. Ask at most once per conversation; otherwise make the best reasonable assumption and proceed.
- The Behavior Tree tool's {"kind":"tree",...} shape, described below, when asked to create/change/fix/extend a behavior tree.
- {"kind":"padProposal","layout":{...a complete CustomGamepadLayout...}} when asked to create or repair a Pad. Reuse the id/gridSize/cellSize/rosConfig/metadata shape of any Pad given as context; otherwise invent a reasonable new one.
- {"kind":"rosAction","operation":{"kind":"topic"|"service"|"action","name":"/...","messageType":"pkg/Type","payload":{...},"timeoutMs":number},"rationale":"one sentence"} when asked what publish, service request, or action goal would be correct. This remains a review-only proposal in chat; direct execution is unavailable.`;

const PAD_PROMPT_FRAGMENT = `## Pad tool
A Pad ("custom gamepad") is a CustomGamepadLayout placed on a grid. Return it as
{"kind":"padProposal","layout":{ ...layout... }}.

Layout shape:
{"id":"kebab-id","name":"Pad name","description":"short purpose","gridSize":{"width":8,"height":4},"cellSize":80,"components":[...],"rosConfig":{"defaultTopic":"/joy","defaultMessageType":"sensor_msgs/msg/Joy"},"metadata":{"created":"<ISO>","modified":"<ISO>","version":"1.0.0"}}

Component shape (these are Robo-Boy's real persisted fields):
{"id":"unique-id","type":"joystick|physical-gamepad|button|dpad|toggle|slider|camera|plot|heartbeat","position":{"x":0,"y":0,"width":3,"height":3},"label":"Visible label","action":{...},"eventOperations":{...},"config":{...}}
- "position" is in grid cells and must fit inside gridSize; components must not overlap.
- "action" is the component's primary topic binding: {"topic":"/name","messageType":"pkg/msg/Type","field":"axes"}. The key is "topic", never "topicName".
- Service calls and action goals belong in "eventOperations" on a button, toggle, or physical-gamepad binding; primary component rendering expects a topic.
- "eventOperations" holds optional extra calls fired by button-like components, keyed press/release/on/off. Each is
  {"kind":"topic"|"service"|"action","name":"/name","messageType":"pkg/msg/Type","payload":{...},"timeoutMs":10000}.

Message types and fields that each component type supports (use these exact strings; ROS 2 "pkg/msg/Type" form is preferred):
- joystick: sensor_msgs/Joy (field "axes"), geometry_msgs/Twist, geometry_msgs/TwistStamped, geometry_msgs/PoseStamped, std_msgs/Float32|Float64|Int32. config: {"maxValue":1,"axes":["0","1"],"axisScales":[1,1]}; Joy axes are numeric index strings, Twist axes are paths such as "linear.x" and "angular.z".
- physical-gamepad: sensor_msgs/Joy with field "axes". config: {"physicalGamepadProfile":"auto","physicalGamepadDeadzone":0.08,"physicalGamepadPublishHz":20}.
- button: std_msgs/Bool, std_msgs/Int32, geometry_msgs/Twist(Stamped). config: {"momentary":true,"messagePath":"data","pressedValue":1,"releasedValue":0} or {"buttonIndex":0} for Joy buttons.
- dpad: sensor_msgs/Joy or geometry_msgs/PoseStamped. config: {"buttonMapping":{"up":0,"down":1,"left":2,"right":3}}.
- toggle: std_msgs/Bool only. config: {"messagePath":"data"}.
- slider: std_msgs/Float32|Float64|Int32, field "data". config: {"min":0,"max":1,"step":0.01,"orientation":"horizontal"}.
- camera: sensor_msgs/Image or sensor_msgs/CompressedImage. config: {"cameraTransport":"proxy"}.
- plot: numeric topics. config: {"fieldPaths":["linear.x"],"timeWindowSec":10}.
- heartbeat: any status topic. config: {"heartbeatMode":"boolean"|"pulse","heartbeatTimeoutMs":1500,"heartbeatFieldPath":"data"}.

Rules:
- Use ONLY topic/service/action names and message types that appear in the ROS context supplied above. Never invent a
  topic name. If the robot exposes /cmd_vel as geometry_msgs/msg/Twist, bind to that exact name and type.
- If no ROS context is available, say so with an explanation instead of guessing topic names.
- Give every component a distinct id and a human label, and fill "rosConfig" from the pad's primary topic.
- When repairing a Pad, keep every field that already works and change only the references reported as mismatched.
- Use the supplied interface schema to build payloads and field mappings. If a schema was unavailable, keep the proposal in the Pad editor for human review and say so in the description.

Complete valid example (two sticks driving one Joy topic):
{"kind":"padProposal","layout":{"id":"drive-pad","name":"Drive Pad","gridSize":{"width":8,"height":4},"cellSize":80,"components":[{"id":"left-stick","type":"joystick","position":{"x":0,"y":1,"width":3,"height":3},"label":"Left Stick","action":{"topic":"/joy","messageType":"sensor_msgs/msg/Joy","field":"axes"},"config":{"min":-1,"max":1,"axes":["0","1"]}},{"id":"right-stick","type":"joystick","position":{"x":5,"y":1,"width":3,"height":3},"label":"Right Stick","action":{"topic":"/joy","messageType":"sensor_msgs/msg/Joy","field":"axes"},"config":{"min":-1,"max":1,"axes":["2","3"]}}],"rosConfig":{"defaultTopic":"/joy","defaultMessageType":"sensor_msgs/msg/Joy"},"metadata":{"created":"2026-01-01T00:00:00.000Z","modified":"2026-01-01T00:00:00.000Z","version":"1.0.0"}}}`;

/** Every capability the assistant has, each declared beside the code that implements it. Adding a
 * tool means adding it here; the registry is what the model is told, and `capabilities.test.ts`
 * holds each entry to what its implementation actually does. */
export const ASSISTANT_CAPABILITIES: readonly AssistantCapability[] = [
  TF_CAPABILITY,
  PAD_CAPABILITY,
  BEHAVIOR_TREE_CAPABILITY,
  ROS_OPERATION_CAPABILITY,
];

const domainFragments = (needs: { behaviorTree: boolean; pad: boolean; rosAction: boolean }): string[] => {
  const fragments: string[] = [];
  if (needs.behaviorTree) fragments.push(BEHAVIOR_TREE_PROMPT_FRAGMENT);
  if (needs.pad) fragments.push(PAD_PROMPT_FRAGMENT);
  return fragments;
};

export interface ComposeSystemPromptInput {
  settings: Pick<AssistantSettings, 'systemContext' | 'robotContext'>;
  /** Gathered by the assistant itself every turn — always present, never user-managed. */
  autoContext: AssistantAutoContext;
  /** Items the user explicitly pinned with `@` or the `+` picker. */
  pinnedChips: AssistantContextChip[];
  /** Which domain-specific instruction fragments are relevant to this turn — keeping prompts
   * small for simple turns instead of always paying for every domain's schema text. */
  needs: { behaviorTree: boolean; pad: boolean; rosAction: boolean };
}

const describeAutoContext = (auto: AssistantAutoContext): string => {
  const sections: string[] = [];
  sections.push(`### Workspace\n${JSON.stringify(auto.workspace)}`);

  if (auto.ros) {
    const age = Math.round((Date.now() - auto.ros.fetchedAt) / 1000);
    const staleNote = auto.ros.stale ? ' (STALE: the ROS connection was re-established after this was captured)' : '';
    sections.push(`### Live ROS graph [captured ${age}s ago${staleNote}]\n${JSON.stringify(auto.ros.resources)}`);
  } else {
    sections.push('### Live ROS graph\nUnavailable — no ROS connection, so no topic, service, or action names are known. Do not invent any.');
  }

  if (auto.openBehaviorTree) {
    sections.push(`### Behavior Tree currently open in the editor\n${JSON.stringify(auto.openBehaviorTree.tree)}`);
  }
  if (auto.selectedBehaviorTreeNodes) {
    sections.push(`### Nodes the user has selected in that tree\n${JSON.stringify(auto.selectedBehaviorTreeNodes)}`);
  }
  if (auto.selectedPad) {
    sections.push(`### Pad currently selected or open\n${JSON.stringify(auto.selectedPad.layout)}`);
  }
  if (auto.rosCatalog) {
    sections.push(`### ROS nodes and parameters\n${JSON.stringify(auto.rosCatalog)}`);
  }
  if (auto.padLibrary.length > 0) {
    sections.push(`### Every saved Pad, complete\n${JSON.stringify(auto.padLibrary)}`);
  }
  if (auto.behaviorTreeLibrary.length > 0) {
    sections.push(`### Every saved Behavior Tree, complete\n${JSON.stringify(auto.behaviorTreeLibrary)}`);
  }
  if (auto.interfaceSchemas) {
    sections.push(`### Retrieved ROS interface schemas\n${JSON.stringify(auto.interfaceSchemas)}`);
  }
  return sections.join('\n\n');
};

/**
 * Composes the system prompt: fixed persona/safety preamble, the response contract, only the
 * domain fragments relevant to this turn, user-configured instructions, the automatically
 * gathered context, and any explicitly pinned items — each tagged with its own provenance and
 * freshness so nothing is silently merged.
 */
export const composeAssistantSystemPrompt = ({
  settings,
  autoContext,
  pinnedChips,
  needs,
}: ComposeSystemPromptInput): string => {
  const parts = [
    BASE_PERSONA,
    describeCapabilities(ASSISTANT_CAPABILITIES),
    RESPONSE_CONTRACT,
    ...domainFragments(needs),
    settings.systemContext.trim() && `Additional assistant instructions:\n${settings.systemContext.trim()}`,
    settings.robotContext.trim() && `Robot and mission context:\n${settings.robotContext.trim()}`,
    `## Automatically gathered context\n${describeAutoContext(autoContext)}`,
  ];

  if (pinnedChips.length > 0) {
    const chipLines = pinnedChips.map(chip => {
      const staleNote = chip.stale ? ' (stale — a reconnect happened since this was fetched)' : '';
      const ageSeconds = Math.round((Date.now() - chip.fetchedAt) / 1000);
      return `### ${chip.label} [source: ${chip.source}, fetched ${ageSeconds}s ago${staleNote}]\n${JSON.stringify(chip.value)}`;
    });
    parts.push(`## Items the user explicitly pinned for this turn\n${chipLines.join('\n\n')}`);
  }

  return parts.filter(Boolean).join('\n\n');
};
