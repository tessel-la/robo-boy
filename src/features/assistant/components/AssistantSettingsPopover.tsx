import React from 'react';
import { FaSyncAlt } from 'react-icons/fa';
import type { AssistantProviderId, AssistantSettings } from '../types';
import { transcribeAssistantAudio } from '../providers/transcription';
import AssistantSpeechTextarea from './AssistantSpeechTextarea';
import AssistantSubscriptionSettings from './AssistantSubscriptionSettings';
import { getProviderDefaults } from '../storage/assistantStorage';
import AssistantThinkingSettings from './AssistantThinkingSettings';
import { getDesktopBridge } from '../../../runtime/desktopBridge';
import type { ApiKeyStoragePolicy, ApiKeyStorageState } from '../../../runtime/assistantSubscription';

interface AssistantSettingsPopoverProps {
  settings: AssistantSettings;
  resolvedBaseUrl: string;
  onProviderChange: (provider: AssistantProviderId) => void;
  onUpdate: (patch: Partial<AssistantSettings>) => void;
  ollamaModels: string[];
  ollamaModelsError: string;
  isLoadingOllamaModels: boolean;
  onRefreshOllamaModels: () => void;
  apiKeyStorage?: ApiKeyStorageState;
  loadingCredentials?: boolean;
  onApiKeyStorageChange?: (policy: ApiKeyStoragePolicy) => void;
}

/** Provider, model, voice, and context settings presented with the same section hierarchy used by
 * the rest of the workspace settings surfaces. */
const AssistantSettingsPopover: React.FC<AssistantSettingsPopoverProps> = ({
  settings,
  resolvedBaseUrl,
  onProviderChange,
  onUpdate,
  ollamaModels,
  ollamaModelsError,
  isLoadingOllamaModels,
  onRefreshOllamaModels,
  apiKeyStorage,
  loadingCredentials,
  onApiKeyStorageChange,
}) => (
  <div className="assistant-settings-popover" role="dialog" aria-label="Assistant settings">
    <div className="assistant-settings-popover-header">
      <div className="assistant-settings-heading">
        <span>AI assistant</span>
        <h3>Settings</h3>
      </div>
    </div>
    <div className="assistant-settings">
      <section className="assistant-settings-section" aria-labelledby="assistant-connection-settings">
        <h4 id="assistant-connection-settings">Connection</h4>
        <div className="assistant-settings-grid">
          <label>
            Provider
            <select
              value={settings.provider}
              onChange={event => onProviderChange(event.target.value as AssistantProviderId)}
            >
              <option value="anthropic">Anthropic Claude</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Google Gemini</option>
              <option value="ollama">Ollama</option>
              <option value="openai-compatible">OpenAI-compatible / local</option>
            </select>
          </label>
          {(settings.provider === 'openai' || settings.provider === 'anthropic') && (
            <label>
              Authentication
              <select
                value={settings.authMode ?? 'api-key'}
                onChange={event =>
                  onUpdate({
                    authMode: event.target.value as 'api-key' | 'subscription',
                    thinkingEffort: undefined,
                    model: event.target.value === 'subscription' ? '' : getProviderDefaults(settings.provider).model,
                  })
                }
              >
                <option value="api-key">API key</option>
                <option value="subscription">Sign in</option>
              </select>
            </label>
          )}
          {settings.authMode === 'subscription' &&
          (settings.provider === 'openai' || settings.provider === 'anthropic') ? (
            <AssistantSubscriptionSettings
              provider={settings.provider}
              model={settings.model}
              thinkingEffort={settings.thinkingEffort}
              onThinkingChange={thinkingEffort => onUpdate({ thinkingEffort })}
              onModelChange={model => onUpdate({ model, thinkingEffort: undefined })}
            />
          ) : (
            <>
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
                  <span>Use connected backend host</span>
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
                </label>
              )}
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
                      {settings.model && !ollamaModels.includes(settings.model) && (
                        <option value={settings.model}>{settings.model}</option>
                      )}
                      {!settings.model && (
                        <option value="">{isLoadingOllamaModels ? 'Loading models…' : 'No models available'}</option>
                      )}
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
                  <input
                    value={settings.model}
                    onChange={event => onUpdate({ model: event.target.value, thinkingEffort: undefined })}
                  />
                </label>
              )}
              <label>
                API key
                <input
                  type="password"
                  autoComplete="off"
                  value={settings.apiKey}
                  onChange={event => onUpdate({ apiKey: event.target.value })}
                  placeholder={
                    settings.provider === 'openai-compatible' || settings.provider === 'ollama'
                      ? 'Optional for local models'
                      : 'Required'
                  }
                />
              </label>
              {getDesktopBridge()?.assistant?.getApiKeyStorage && onApiKeyStorageChange && (
                <div className="assistant-setting-field assistant-key-storage-field">
                  <label>
                    Remember API key
                    <select
                      disabled={loadingCredentials}
                      value={apiKeyStorage?.policy ?? 'automatic'}
                      onChange={event => onApiKeyStorageChange(event.target.value as ApiKeyStoragePolicy)}
                    >
                      <option value="automatic">Automatic (secure storage)</option>
                      <option value="session">This session only</option>
                      <option value="local">Save unencrypted on this device</option>
                    </select>
                  </label>
                  <span className="assistant-key-note" role="status">
                    {apiKeyStorage?.warning ??
                      (apiKeyStorage?.storage === 'encrypted'
                        ? 'Saved with OS encryption.'
                        : apiKeyStorage?.storage === 'session'
                          ? 'Kept for this app session. Re-enter after quitting Robo-Boy.'
                          : 'Secure storage is used when available. If unavailable, the key stays in this app session.')}
                  </span>
                </div>
              )}
              <AssistantThinkingSettings
                provider={settings.provider}
                model={settings.model}
                value={settings.thinkingEffort}
                onChange={thinkingEffort => onUpdate({ thinkingEffort })}
              />
            </>
          )}
        </div>
      </section>
      <section className="assistant-settings-section is-single" aria-labelledby="assistant-voice-settings">
        <h4 id="assistant-voice-settings">Voice</h4>
        <div className="assistant-settings-grid">
          <label>
            Recognition language
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
        </div>
      </section>
      <section className="assistant-settings-section is-single" aria-labelledby="assistant-context-settings">
        <h4 id="assistant-context-settings">Context</h4>
        <div className="assistant-settings-grid">
          <AssistantSpeechTextarea
            id="assistant-system-context"
            label="Assistant instructions"
            rows={2}
            value={settings.systemContext}
            onChange={systemContext => onUpdate({ systemContext })}
            onTranscribeAudio={audio => transcribeAssistantAudio(audio, { ...settings, baseUrl: resolvedBaseUrl })}
            placeholder="Safety constraints, preferred conventions…"
          />
          <AssistantSpeechTextarea
            id="assistant-robot-context"
            label="Robot / mission context"
            rows={3}
            value={settings.robotContext}
            onChange={robotContext => onUpdate({ robotContext })}
            onTranscribeAudio={audio => transcribeAssistantAudio(audio, { ...settings, baseUrl: resolvedBaseUrl })}
            placeholder="Robot capabilities, frames, operational rules…"
          />
        </div>
      </section>
      <p className="assistant-key-note">
        {settings.authMode === 'subscription'
          ? 'Subscription credentials stay in the desktop runtime. ChatGPT credentials use the OS credential store; Claude Code manages its own sign-in. Conversation history stays in this browser.'
          : getDesktopBridge()?.assistant?.setApiKey
            ? getDesktopBridge()?.assistant?.getApiKeyStorage
              ? 'API keys use OS encryption when available; storage failures do not prevent use. Your OS may request keychain access. This session only and unencrypted saving avoid keychain access. Conversation history stays on this device.'
              : 'This desktop version saves API keys locally without encryption. Update Robo-Boy to use secure storage. Conversation history stays on this device.'
            : 'API keys and conversation history are stored in this browser. For shared deployments, use a server-side proxy instead of storing production keys here.'}
      </p>
    </div>
  </div>
);

export default AssistantSettingsPopover;
