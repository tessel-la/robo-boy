import { useEffect, useId, useState } from 'react';
import { getDesktopBridge } from '../../../runtime/desktopBridge';
import type { AssistantSettings } from '../types';

/** Select from the account/local catalog where available; API-compatible endpoints may use
 * arbitrary model IDs, so retain direct entry instead of inventing a list of supported models. */
export function AssistantModelControl({
  settings,
  ollamaModels,
  disabled,
  onUpdate,
}: {
  settings: AssistantSettings;
  ollamaModels: string[];
  disabled: boolean;
  onUpdate: (patch: Partial<AssistantSettings>) => void;
}) {
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(settings.model);
  const listId = useId();
  useEffect(() => {
    setDraft(settings.model);
  }, [settings.model]);
  useEffect(() => {
    let active = true;
    setModels([]);
    setError('');
    if (settings.authMode !== 'subscription' || !['openai', 'anthropic'].includes(settings.provider)) return;
    const bridge = getDesktopBridge()?.assistant;
    if (!bridge) {
      setError('Subscription models require Electron.');
      return;
    }
    void bridge
      .getState(settings.provider as 'openai' | 'anthropic')
      .then(state => {
        if (!active) return;
        if (
          !Array.isArray(state?.models) ||
          state.models.some(item => !item || typeof item.id !== 'string' || typeof item.label !== 'string')
        )
          throw new Error('Invalid model catalog.');
        setModels(state.models);
        setError(state.error ?? '');
      })
      .catch(() => {
        if (active) setError('Model catalog unavailable. Your selected model was kept; check connection settings.');
      });
    return () => {
      active = false;
    };
  }, [settings.provider, settings.authMode]);
  const choices = settings.provider === 'ollama' ? ollamaModels.map(id => ({ id, label: id })) : models;
  const change = (model: string) => {
    if (model.trim() && model.trim() !== settings.model) onUpdate({ model: model.trim(), thinkingEffort: undefined });
  };
  return (
    <label className="assistant-chat-model" title={error || settings.model}>
      <span>Model{error && <small role="status"> · catalog unavailable</small>}</span>
      {choices.length ? (
        <select
          aria-label="Chat model"
          disabled={disabled}
          value={settings.model}
          onChange={event => change(event.target.value)}
        >
          {!choices.some(item => item.id === settings.model) && (
            <option value={settings.model}>{settings.model || 'Choose model'}</option>
          )}
          {choices.map(item => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      ) : (
        <>
          <input
            aria-label="Chat model"
            list={listId}
            disabled={disabled}
            value={draft}
            maxLength={200}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => change(draft)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
          <datalist id={listId}>
            <option value={settings.model} />
          </datalist>
        </>
      )}
    </label>
  );
}
