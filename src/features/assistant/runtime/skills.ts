import { createUuid } from '../../../utils/uuid';
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  builtin?: boolean;
}
const workflow = (id: string, name: string, description: string, instructions: string): AgentSkill => ({
  id,
  name,
  description,
  instructions,
  enabled: true,
  builtin: true,
});
export const BUILTIN_SKILLS: readonly AgentSkill[] = [
  workflow(
    'pad-repair',
    'Repair a Pad',
    'Find and repair broken Pad topics, types, fields or executable bindings.',
    'Read the complete Pad and its revision. Discover the current graph. Retrieve schemas for referenced interfaces. Compare field paths, types and executable events. Change only broken components, preserve unrelated configuration, save with the base revision and read back. Never execute the robot to test the Pad.'
  ),
  workflow(
    'home-capture',
    'Capture Home',
    'Make a Home control from an observed robot pose.',
    'Read current joint states and controller information. Resolve controlled joint names and order, excluding uncontrolled joints only when evidence supports it. Retrieve the trajectory goal schema. Use finite measured positions, not invented values, and provide a complete timed goal in eventOperations.press. A captured target is not a collision-checked path. Save authoring with a checkpoint; activation and movement remain operator controlled. Ask a question only if actual controller evidence cannot resolve a necessary choice.'
  ),
  workflow(
    'bt-authoring',
    'Author a Behavior Tree',
    'Build or edit an executable Behavior Tree document without running it.',
    'Read the requested tree, selected nodes and revision. Discover relevant ROS resources and retrieve required action/service schemas. Preserve unrelated graph structure and blackboard bindings. Validate edge targets, cycles, subtrees and payloads. Save authoring, read back and explain assumptions. Never start or alter a running execution.'
  ),
  workflow(
    'tf-diagnosis',
    'Diagnose TF',
    'Investigate missing frames, disconnected TF trees or transforms.',
    'Capture the TF graph and query requested transforms. Distinguish missing edges, stale dynamic transforms, disconnected components and cycles. Check exact existing frame names. Report capture time and whether the source is live or replay. Configure TF/3D presentation through the relevant panel only when requested.'
  ),
  workflow(
    'controller-inspection',
    'Inspect controllers',
    'Find controller interfaces, joint configuration and ROS errors.',
    'Discover nodes, parameters, actions and topics. Read targeted controller parameters and relevant logs. Correlate timestamps and observed status. Do not infer readiness merely from interface presence. Never call lifecycle/control services or set parameters.'
  ),
  workflow(
    'plotting',
    'Plot robot signals',
    'Create and configure Time Series panels from live or recorded signals.',
    'Discover the requested topic, retrieve a sample and schema, and resolve numeric field paths with labels and units. Add the panel and await host acknowledgement before configuring it. Read workspace afterward to verify signal configuration and observed samples. Missing samples are not zero values.'
  ),
];
const KEY = 'robo-boy-agent-skills-v1';
export function loadSkills(): AgentSkill[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 256 * 1024) return [...BUILTIN_SKILLS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...BUILTIN_SKILLS];
    const valid = parsed.filter(
      item =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.description === 'string' &&
        typeof item.instructions === 'string' &&
        item.instructions.length <= 24_000 &&
        typeof item.enabled === 'boolean'
    );
    return [
      ...BUILTIN_SKILLS.map(skill => ({
        ...skill,
        enabled: valid.find(item => item.id === skill.id)?.enabled ?? true,
      })),
      ...valid
        .filter(item => !BUILTIN_SKILLS.some(skill => skill.id === item.id))
        .map(item => ({ ...item, builtin: false })),
    ].slice(0, 40);
  } catch {
    return [...BUILTIN_SKILLS];
  }
}
export function storeSkills(skills: AgentSkill[]): void {
  const value = JSON.stringify(skills.slice(0, 40));
  if (value.length > 256 * 1024) throw new Error('Skill storage exceeds 256 KiB.');
  localStorage.setItem(KEY, value);
}
/** Import is an explicit user action, never an agent tool. Only instructions are supported;
 * scripts, hooks and filesystem references do not acquire execution capability. */
export function importSkill(markdown: string): AgentSkill {
  if (markdown.length > 24_000) throw new Error('The skill exceeds 24 KiB.');
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]+)$/);
  if (!match) throw new Error('Use an instruction-only SKILL.md with name and description frontmatter.');
  const field = (key: string) => match[1].match(new RegExp(`^${key}:\\s*["']?([^\\n]+?)["']?\\s*$`, 'm'))?.[1]?.trim();
  const name = field('name'),
    description = field('description');
  if (!name || !/^[a-zA-Z0-9 -]{1,80}$/.test(name) || !description || description.length > 1000)
    throw new Error('Skill name and description must be bounded single-line values.');
  return { id: `user-${createUuid()}`, name, description, instructions: match[2].trim(), enabled: true };
}
