import { useEffect, useRef, useState } from 'react';
import { getDesktopBridge } from '../../../runtime/desktopBridge';
import { loadAssistantSettings, saveAssistantSettings } from './assistantStorage';
import type { AssistantSettings } from '../types';
import type { ApiKeyStoragePolicy, ApiKeyStorageState } from '../../../runtime/assistantSubscription';

/** Settings stay local; Electron keys are hydrated into memory and persisted natively. */
export function useAssistantSettings() {
  const [settings, setSettings] = useState(loadAssistantSettings);
  const [storageError, setStorageError] = useState('');
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [apiKeyStorage, setApiKeyStorage] = useState<ApiKeyStorageState>();
  const current = useRef(settings);
  const legacy = useRef(settings);
  const bridge = getDesktopBridge()?.assistant;
  const nativeKeys = !!bridge?.getApiKey && !!bridge?.setApiKey;
  const migrationDone = useRef(!nativeKeys || !legacy.current.apiKey);
  const initialization = useRef<Promise<void>>();
  const legacyKeyUpdate = useRef<Promise<unknown>>();
  const keyEpoch = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const persist = () => {
    if (migrationDone.current) saveAssistantSettings(current.current, nativeKeys);
  };
  useEffect(() => {
    if (!nativeKeys) return;
    let cancelled = false;
    const provider = settings.provider;
    const epoch = keyEpoch.current;
    setApiKeyStorage(undefined);
    setStorageError('');
    setLoadingCredentials(true);
    if (!initialization.current)
      initialization.current = (async () => {
        if (!migrationDone.current) {
          const stored = await bridge!.getApiKey!(legacy.current.provider);
          // A key edited while the native read was pending takes precedence over migration.
          if (legacyKeyUpdate.current) await legacyKeyUpdate.current;
          else if (stored === undefined) await bridge!.setApiKey!(legacy.current.provider, legacy.current.apiKey);
        }
        migrationDone.current = true;
        if (mounted.current) persist();
      })();
    void initialization.current
      .then(() => bridge!.getApiKey!(provider))
      .then(async key => {
        const state = await bridge!.getApiKeyStorage?.(provider);
        if (cancelled || keyEpoch.current !== epoch) return;
        current.current = { ...current.current, apiKey: key ?? '' };
        setSettings(current.current);
        setApiKeyStorage(state);
      })
      .catch(() => {
        if (!cancelled && keyEpoch.current === epoch)
          setStorageError(
            'Could not load the saved API key. You can enter it once again and keep using the assistant. Existing records are retained until migration succeeds.'
          );
      })
      .finally(() => {
        if (!cancelled) setLoadingCredentials(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nativeKeys, bridge, settings.provider]);

  const updateSettings = (patch: Partial<AssistantSettings>) => {
    const providerChanged = patch.provider !== undefined && patch.provider !== current.current.provider;
    if (providerChanged || patch.apiKey !== undefined) keyEpoch.current++;
    current.current = { ...current.current, ...patch };
    setSettings(current.current);
    persist();
    if (nativeKeys && patch.apiKey !== undefined && !providerChanged) {
      saveKey(patch.apiKey);
    }
  };

  const saveKey = (key: string, policy?: ApiKeyStoragePolicy) => {
    const provider = current.current.provider;
    const epoch = keyEpoch.current;
    setStorageError('');
    setLoadingCredentials(false);
    if (policy) setApiKeyStorage({ policy, storage: 'none', warning: 'Updating key storage…' });
    const saved = policy === undefined ? bridge!.setApiKey!(provider, key) : bridge!.setApiKey!(provider, key, policy);
    if (provider === legacy.current.provider) legacyKeyUpdate.current = saved;
    void saved
      .then(state => {
        if (mounted.current && keyEpoch.current === epoch && state) setApiKeyStorage(state);
        if (!migrationDone.current && provider === legacy.current.provider) {
          migrationDone.current = true;
          initialization.current = Promise.resolve();
          if (mounted.current) persist();
        }
      })
      .catch(() => {
        if (mounted.current && keyEpoch.current === epoch) {
          setApiKeyStorage({ policy: policy ?? apiKeyStorage?.policy ?? 'automatic', storage: 'session' });
          setStorageError(
            'The API key is kept for this session but could not be saved on this device. Check storage permissions and available space, then enter the key again.'
          );
        }
      });
  };
  const updateApiKeyStorage = (policy: ApiKeyStoragePolicy) => {
    if (!nativeKeys || !bridge?.getApiKeyStorage || loadingCredentials) return;
    keyEpoch.current++;
    saveKey(current.current.apiKey, policy);
  };
  return { settings, updateSettings, storageError, loadingCredentials, apiKeyStorage, updateApiKeyStorage };
}
