import React from 'react';
import { FaSyncAlt, FaTimes } from 'react-icons/fa';
import type { AssistantProviderId, AssistantSettings } from '../types';
import { transcribeAssistantAudio } from '../providers/transcription';
import AssistantSpeechTextarea from './AssistantSpeechTextarea';

interface AssistantSettingsPopoverProps {
  settings: AssistantSettings;
  resolvedBaseUrl: string;
  onProviderChange: (provider: AssistantProviderId) => void;
  onUpdate: (patch: Partial<AssistantSettings>) => void;
  onClose: () => void;
  ollamaModels: string[];
  ollamaModelsError: string;
  isLoadingOllamaModels: boolean;
  onRefreshOllamaModels: () => void;
}

/** Provider/model/key settings — same small popover-anchored-to-a-toggle-button convention as the
 * former BT-agent settings UI (plan §5's "AssistantSettingsPopover.tsx"), generalized to 5
 * providers and no longer BT-specific. */
const AssistantSettingsPopover: React.FC<AssistantSettingsPopoverProps> = ({
  settings,
  resolvedBaseUrl,
  onProviderChange,
  onUpdate,
  onClose,
  ollamaModels,
  ollamaModelsError,
  isLoadingOllamaModels,
  onRefreshOllamaModels,
}) => (
  <div className="assistant-settings-popover" role="dialog" aria-label="Assistant settings">
    <div className="assistant-settings-popover-header">
      <strong>Assistant settings</strong>
      <button type="button" onClick={onClose} aria-label="Close assistant settings">
        <FaTimes aria-hidden="true" />
      </button>
    </div>
    <div className="assistant-settings">
      <label>
        Provider
        <select value={settings.provider} onChange={event => onProviderChange(event.target.value as AssistantProviderId)}>
          <option value="anthropic">Anthropic Claude</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Google Gemini</option>
          <option value="ollama">Ollama</option>
          <option value="openai-compatible">OpenAI-compatible / local</option>
        </select>
      </label>
      <label>
        Base URL
        <input
          value={resolvedBaseUrl}
          disabled={settings.provider === 'ollama' && settings.ollamaUseBackendHost}
          onChange={event => onUpdate({ baseUrl: event.target.value })}
        />
      </label>
      {settings.provider === 'ollama' && (
        <label className="assistant-ollama-backend-toggle">
          <input
            type="checkbox"
            checked={settings.ollamaUseBackendHost}
            onChange={event =>
              onUpdate({
                ollamaUseBackendHost: event.target.checked,
                ...(!event.target.checked ? { baseUrl: resolvedBaseUrl } : {}),
              })
            }
          />
          Use connected backend host
        </label>
      )}
      <label>
        Voice language
        <select value={settings.voiceLanguage} onChange={event => onUpdate({ voiceLanguage: event.target.value })}>
          {/* The browser recogniser hears everything as the language it is told to expect, so this
              is what makes dictating in a language other than the device's own work. */}
          <option value="">Follow this device ({navigator.language || 'en-US'})</option>
          <option value="en-US">English (US)</option>
          <option value="en-GB">English (UK)</option>
          <option value="it-IT">Italiano</option>
          <option value="es-ES">Español</option>
          <option value="fr-FR">Français</option>
          <option value="de-DE">Deutsch</option>
          <option value="pt-BR">Português (BR)</option>
        </select>
      </label>
      {settings.provider === 'ollama' ? (
        <div className="assistant-setting-field">
          <label htmlFor="assistant-ollama-model">Model</label>
          <div className="assistant-model-select-row">
            <select
              id="assistant-ollama-model"
              value={settings.model}
              onChange={event => onUpdate({ model: event.target.value })}
              disabled={isLoadingOllamaModels || ollamaModels.length === 0}
            >
              {settings.model && !ollamaModels.includes(settings.model) && <option value={settings.model}>{settings.model}</option>}
              {!settings.model && <option value="">{isLoadingOllamaModels ? 'Loading models…' : 'No models available'}</option>}
              {ollamaModels.map(model => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="assistant-model-refresh"
              onClick={onRefreshOllamaModels}
              disabled={isLoadingOllamaModels}
              aria-label="Refresh Ollama models"
              title="Refresh Ollama models"
            >
              <FaSyncAlt className={isLoadingOllamaModels ? 'spinning' : ''} aria-hidden="true" />
            </button>
          </div>
          {ollamaModelsError && (
            <span className="assistant-model-error" role="status">
              {ollamaModelsError}
            </span>
          )}
        </div>
      ) : (
        <label>
          Model
          <input value={settings.model} onChange={event => onUpdate({ model: event.target.value })} />
        </label>
      )}
      <label>
        API key
        <input
          type="password"
          autoComplete="off"
          value={settings.apiKey}
          onChange={event => onUpdate({ apiKey: event.target.value })}
          placeholder={settings.provider === 'openai-compatible' || settings.provider === 'ollama' ? 'Optional for local models' : 'Required'}
        />
      </label>
      <AssistantSpeechTextarea
        id="assistant-system-context"
        className="assistant-wide"
        label="Assistant instructions"
        rows={2}
        value={settings.systemContext}
        onChange={systemContext => onUpdate({ systemContext })}
        onTranscribeAudio={audio => transcribeAssistantAudio(audio, { ...settings, baseUrl: resolvedBaseUrl })}
        placeholder="Safety constraints, preferred conventions…"
      />
      <AssistantSpeechTextarea
        id="assistant-robot-context"
        className="assistant-wide"
        label="Robot / mission context"
        rows={3}
        value={settings.robotContext}
        onChange={robotContext => onUpdate({ robotContext })}
        onTranscribeAudio={audio => transcribeAssistantAudio(audio, { ...settings, baseUrl: resolvedBaseUrl })}
        placeholder="Robot capabilities, frames, operational rules…"
      />
      <p className="assistant-key-note">
        Settings and conversation history stay in this browser (see docs/ai-assistant.md). For shared deployments, use a
        server-side proxy instead of storing production keys here — this is unchanged from before and still applies to
        every cloud provider, including Anthropic direct-browser calls.
      </p>
    </div>
  </div>
);

export default AssistantSettingsPopover;
