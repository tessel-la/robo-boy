import React, { useEffect, useRef, useState } from 'react';
import { getDesktopBridge } from '../../../runtime/desktopBridge';
import type { SubscriptionProvider, SubscriptionState } from '../../../runtime/assistantSubscription';
import { subscriptionErrorMessage } from '../../../runtime/assistantSubscription';
import type { ThinkingEffort } from '../providers/thinking';
import AssistantThinkingSettings from './AssistantThinkingSettings';

interface Props {
  provider: SubscriptionProvider;
  model: string;
  onModelChange: (model: string) => void;
  thinkingEffort?: ThinkingEffort;
  onThinkingChange: (effort: ThinkingEffort | undefined) => void;
}

const AssistantSubscriptionSettings: React.FC<Props> = ({
  provider,
  model,
  onModelChange,
  thinkingEffort,
  onThinkingChange,
}) => {
  const bridge = getDesktopBridge()?.assistant;
  const [state, setState] = useState<SubscriptionState>({ accounts: [], models: [] });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const modelRef = useRef(model);
  modelRef.current = model;
  const apply = (next: SubscriptionState) => {
    // Check before scheduling a render. An invalid bridge reply must become a local error,
    // never replace the entire application's tree with the global error boundary.
    if (
      !next ||
      !Array.isArray(next.accounts) ||
      !Array.isArray(next.models) ||
      next.accounts.some(
        account =>
          !account ||
          typeof account.id !== 'string' ||
          typeof account.label !== 'string' ||
          typeof account.connected !== 'boolean' ||
          typeof account.planEnabled !== 'boolean'
      ) ||
      next.models.some(item => !item || typeof item.id !== 'string' || typeof item.label !== 'string') ||
      (next.error !== undefined && typeof next.error !== 'string')
    ) {
      throw new Error('The desktop runtime returned an invalid account state. Refresh or restart Robo-Boy.');
    }
    setState(next);
    if (next.models.length && !next.models.some(item => item.id === modelRef.current)) onModelChange(next.models[0].id);
  };
  useEffect(() => {
    if (!bridge) return;
    const current = ++epoch.current;
    setBusy('Loading account…');
    setError('');
    setState({ accounts: [], models: [] });
    bridge
      .getState(provider)
      .then(next => {
        if (epoch.current === current) apply(next);
      })
      .catch(cause => {
        if (epoch.current === current) setError(subscriptionErrorMessage(cause));
      })
      .finally(() => {
        if (epoch.current === current) setBusy('');
      });
    return () => {
      epoch.current++;
      void bridge.cancelSignIn(provider).catch(() => {});
    };
  }, [bridge, provider]);

  if (!bridge)
    return (
      <p className="assistant-subscription-note" role="status">
        Subscription sign-in is available in the updated Robo-Boy Electron desktop app. On this device, choose API key.
      </p>
    );

  const run = async (label: string, action: () => Promise<SubscriptionState>) => {
    const current = ++epoch.current;
    setBusy(label);
    setError('');
    try {
      const next = await action();
      if (epoch.current === current) apply(next);
    } catch (cause) {
      if (epoch.current !== current) return;
      setError(subscriptionErrorMessage(cause));
      try {
        const next = await bridge.getState(provider);
        if (epoch.current === current) apply(next);
      } catch {
        /* Preserve actionable failure. */
      }
    } finally {
      if (epoch.current === current) setBusy('');
    }
  };
  const active = state.accounts.find(account => account.id === state.activeAccountId);
  const name = provider === 'openai' ? 'ChatGPT' : 'Claude Code';
  return (
    <div className="assistant-subscription-settings">
      {provider === 'openai' && state.accounts.length > 0 && (
        <label>
          Account
          <select
            aria-label="ChatGPT account"
            value={state.activeAccountId ?? ''}
            disabled={!!busy}
            onChange={event => void run('Switching account…', () => bridge.selectAccount(provider, event.target.value))}
          >
            {!state.activeAccountId && <option value="">Choose an account</option>}
            {state.accounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.label} ({account.id.slice(0, 8)}){account.connected ? '' : ' — signed out'}
              </option>
            ))}
          </select>
        </label>
      )}
      <p role="status" className="assistant-subscription-status">
        {busy ||
          (active?.connected
            ? active.planEnabled
              ? `Using ${name} subscription${provider === 'anthropic' ? ` · ${active.label}` : ''}`
              : 'Connected. Reconnect and allow ChatGPT plan usage.'
            : `Sign in to use your ${name} subscription.`)}
      </p>
      <div className="assistant-subscription-actions">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void run('Signing in…', () => bridge.signIn(provider, state.activeAccountId))}
        >
          {active?.connected
            ? 'Reconnect'
            : provider === 'openai'
              ? 'Continue with ChatGPT'
              : 'Sign in through Claude Code'}
        </button>
        {busy === 'Signing in…' && (
          <button
            type="button"
            onClick={() => void bridge.cancelSignIn(provider).catch(cause => setError(subscriptionErrorMessage(cause)))}
          >
            Cancel sign-in
          </button>
        )}
        {provider === 'openai' && state.accounts.length > 0 && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run('Signing in…', () => bridge.signIn(provider))}
          >
            Add account
          </button>
        )}
        {active?.connected && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run('Signing out…', () => bridge.signOut(provider))}
          >
            Sign out
          </button>
        )}
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void run('Refreshing…', () => bridge.getState(provider))}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => void bridge.manageUsage(provider).catch(cause => setError(subscriptionErrorMessage(cause)))}
        >
          Manage usage
        </button>
      </div>
      <label>
        Model
        <select
          aria-label={`${name} subscription model`}
          value={state.models.some(item => item.id === model) ? model : ''}
          disabled={!!busy || !active?.planEnabled || !state.models.length}
          onChange={event => onModelChange(event.target.value)}
        >
          {!state.models.some(item => item.id === model) && <option value="">Choose a model</option>}
          {state.models.map(item => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <AssistantThinkingSettings
        provider={provider}
        model={model}
        subscription
        value={thinkingEffort}
        disabled={!!busy || !active?.planEnabled}
        onChange={onThinkingChange}
      />
      {(error || state.error) && (
        <p className="assistant-model-error" role="alert">
          {error || state.error}
        </p>
      )}
      <p className="assistant-subscription-note">
        {provider === 'openai' ? (
          'Requires an eligible ChatGPT plan and permission to use it. Usage follows your account limits.'
        ) : (
          <>
            Uses the official Claude Code CLI, with runtime tools disabled.{' '}
            <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noreferrer">
              Install Claude Code
            </a>{' '}
            if needed.
          </>
        )}{' '}
        Browser voice recognition is available; recorded-audio transcription requires API-key mode.
      </p>
    </div>
  );
};

export default AssistantSubscriptionSettings;
