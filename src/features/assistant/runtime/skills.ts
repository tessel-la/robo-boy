import { createUuid } from '../../../utils/uuid';
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  builtin?: boolean;
}
// Retire the shipped examples without discarding operator-imported workflows or rewriting storage.
const RETIRED_BUILTIN_IDS = new Set([
  'pad-repair',
  'home-capture',
  'bt-authoring',
  'tf-diagnosis',
  'controller-inspection',
  'plotting',
]);
const KEY = 'robo-boy-agent-skills-v1';
export function loadSkills(): AgentSkill[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 256 * 1024) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
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
    return valid
      .filter(item => !RETIRED_BUILTIN_IDS.has(item.id) && !item.builtin)
      .map(item => ({ ...item, builtin: false }))
      .slice(0, 40);
  } catch {
    return [];
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
