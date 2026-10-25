export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  instructions: string;
  readOnly: boolean;
  model?: string;
  tools?: string[];
  builtin?: boolean;
}
const KEY = 'robo-boy-agent-profiles-v1';
export const BUILTIN_PROFILES: AgentProfile[] = [
  {
    id: 'general',
    name: 'Robo-Boy agent',
    description: 'Autonomous app authoring and diagnostics; robot execution remains operator-owned.',
    instructions: '',
    readOnly: false,
    builtin: true,
  },
  {
    id: 'investigator',
    name: 'Investigator',
    description: 'Read-only diagnosis of ROS, TF, logs and controllers.',
    instructions:
      'Gather actual evidence and distinguish observations from hypotheses. Report sources and freshness. Do not change app state.',
    readOnly: true,
    builtin: true,
  },
  {
    id: 'planner',
    name: 'Planner',
    description: 'Read-only investigation and an implementation/mission plan.',
    instructions:
      'Investigate available resources, then provide a concrete plan and its validation criteria. Never execute the plan.',
    readOnly: true,
    builtin: true,
  },
];
export function loadAgentProfiles(): AgentProfile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 128 * 1024) return [...BUILTIN_PROFILES];
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [...BUILTIN_PROFILES];
    return [
      ...BUILTIN_PROFILES,
      ...value.filter(
        item =>
          item &&
          typeof item.id === 'string' &&
          !BUILTIN_PROFILES.some(profile => profile.id === item.id) &&
          typeof item.name === 'string' &&
          item.name.length <= 80 &&
          typeof item.description === 'string' &&
          typeof item.instructions === 'string' &&
          item.instructions.length <= 16_000 &&
          typeof item.readOnly === 'boolean' &&
          (item.model === undefined ||
            (typeof item.model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(item.model))) &&
          (item.tools === undefined ||
            (Array.isArray(item.tools) && item.tools.every((tool: unknown) => typeof tool === 'string')))
      ),
    ].slice(0, 20);
  } catch {
    return [...BUILTIN_PROFILES];
  }
}
export function saveAgentProfiles(profiles: AgentProfile[]): void {
  const raw = JSON.stringify(profiles.filter(profile => !profile.builtin).slice(0, 17));
  if (raw.length > 128 * 1024) throw new Error('Agent profiles exceed 128 KiB.');
  localStorage.setItem(KEY, raw);
}
