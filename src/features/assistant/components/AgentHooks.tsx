import { useState } from 'react';
import { loadAgentHooks, storeAgentHooks, type AgentHook } from '../runtime/hooks';
import { HOST_TOOL_DEFINITIONS } from '../tools/nativeTools';

export function AgentHooks() {
  const [initial] = useState(() => {
    try {
      return { hooks: loadAgentHooks(), error: '' };
    } catch (cause) {
      return { hooks: [] as AgentHook[], error: String(cause) };
    }
  });
  const [error, setError] = useState(initial.error);
  const [hooks, setHooks] = useState<AgentHook[]>(initial.hooks);
  const save = (next: AgentHook[]) => {
    try {
      storeAgentHooks(next);
      setHooks(next);
      setError('');
    } catch (cause) {
      setError(String(cause));
    }
  };
  const update = (id: string, patch: Partial<AgentHook>) =>
    save(hooks.map(hook => (hook.id === id ? { ...hook, ...patch } : hook)));
  return (
    <details>
      <summary>Tool policies and hooks</summary>
      <p>
        Explicit blocks or reminders at tool boundaries. Policies never execute scripts or grant access. Changes apply
        to the next task.
      </p>
      {hooks.map(hook => (
        <fieldset key={hook.id}>
          <legend>Tool policy</legend>
          <label>
            <input
              type="checkbox"
              checked={hook.enabled}
              onChange={event => update(hook.id, { enabled: event.target.checked })}
            />
            Enabled
          </label>
          <label>
            Tool
            <select value={hook.tool} onChange={event => update(hook.id, { tool: event.target.value })}>
              {HOST_TOOL_DEFINITIONS.map(tool => (
                <option key={tool.name} value={tool.name}>
                  {tool.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Action
            <select
              value={hook.action}
              onChange={event => update(hook.id, { action: event.target.value as AgentHook['action'], when: 'before' })}
            >
              <option value="block">Block before execution</option>
              <option value="note">Reminder</option>
            </select>
          </label>
          {hook.action === 'note' && (
            <label>
              When
              <select
                value={hook.when}
                onChange={event => update(hook.id, { when: event.target.value as AgentHook['when'] })}
              >
                <option value="before">Before execution</option>
                <option value="success">After success</option>
                <option value="error">After error</option>
              </select>
            </label>
          )}
          <label>
            Message
            <textarea
              value={hook.message}
              maxLength={1000}
              onChange={event => update(hook.id, { message: event.target.value })}
            />
          </label>
          <button type="button" onClick={() => save(hooks.filter(item => item.id !== hook.id))}>
            Remove policy
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={hooks.length >= 12}
        onClick={() =>
          save([
            ...hooks,
            {
              id: crypto.randomUUID(),
              enabled: false,
              tool: 'save_document',
              when: 'success',
              action: 'note',
              message: 'Read back the saved document before reporting completion.',
            },
          ])
        }
      >
        Add policy
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
