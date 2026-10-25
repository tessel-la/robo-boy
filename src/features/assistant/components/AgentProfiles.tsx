import { createUuid } from '../../../utils/uuid';
import { useState } from 'react';
import { loadAgentProfiles, saveAgentProfiles } from '../runtime/profiles';
import { HOST_TOOL_DEFINITIONS } from '../tools/nativeTools';

export function AgentProfiles({
  selected,
  onSelect,
}: {
  selected?: string;
  onSelect(id: string, model?: string): void;
}) {
  const [profiles, setProfiles] = useState(loadAgentProfiles),
    [error, setError] = useState('');
  const active = profiles.find(profile => profile.id === selected) ?? profiles[selected ? 1 : 0];
  const update = (patch: Partial<typeof active>) => {
    const next = profiles.map(profile => (profile.id === active.id ? { ...profile, ...patch } : profile));
    try {
      saveAgentProfiles(next);
      setProfiles(next);
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <details>
      <summary>Custom agents</summary>
      <label>
        Agent profile
        <select
          aria-label="Agent profile"
          value={active.id}
          onChange={event => {
            const profile = profiles.find(item => item.id === event.target.value)!;
            onSelect(profile.id, profile.model);
          }}
        >
          {profiles.map(profile => (
            <option value={profile.id} key={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <p>{active.description}</p>
      <button
        type="button"
        onClick={() => {
          const profile = {
            id: createUuid(),
            name: 'Custom investigator',
            description: 'Focused read-only agent',
            instructions: '',
            readOnly: true,
          };
          const next = [...profiles, profile];
          try {
            saveAgentProfiles(next);
            setProfiles(next);
            onSelect(profile.id);
          } catch (cause) {
            setError(String(cause));
          }
        }}
      >
        Create profile
      </button>
      {!active.builtin && (
        <>
          <label>
            Name
            <input value={active.name} maxLength={80} onChange={event => update({ name: event.target.value })} />
          </label>
          <label>
            Instructions
            <textarea
              rows={3}
              maxLength={16000}
              value={active.instructions}
              onChange={event => update({ instructions: event.target.value })}
            />
          </label>
          <label>
            Model override (same provider/account)
            <input value={active.model ?? ''} onChange={event => update({ model: event.target.value || undefined })} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={active.readOnly}
              onChange={event => update({ readOnly: event.target.checked })}
            />
            Read-only
          </label>
          <details>
            <summary>Tool subset</summary>
            {HOST_TOOL_DEFINITIONS.map(tool => (
              <label key={tool.name}>
                <input
                  type="checkbox"
                  checked={!active.tools || active.tools.includes(tool.name)}
                  onChange={event => {
                    const selectedTools = new Set(active.tools ?? HOST_TOOL_DEFINITIONS.map(item => item.name));
                    if (event.target.checked) selectedTools.add(tool.name);
                    else selectedTools.delete(tool.name);
                    update({ tools: [...selectedTools] });
                  }}
                />
                {tool.name}
              </label>
            ))}
          </details>
        </>
      )}
      <small>
        Profiles only narrow host capabilities. Instructions cannot grant robot execution or external permissions.
        Changes apply on the next turn; choosing a model override changes the selected model explicitly.
      </small>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
