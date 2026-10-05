import { useEffect, useRef, useState } from 'react';
import { getDesktopBridge } from '../../../runtime/desktopBridge';
import { loadAssistantSettings, saveAssistantSettings } from './assistantStorage';
import type { AssistantSettings } from '../types';

/** Settings stay local; Electron keys are hydrated into memory and persisted natively. */
export function useAssistantSettings() {
  const [settings, setSettings] = useState(loadAssistantSettings);
  const [storageError, setStorageError] = useState('');
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const current = useRef(settings);
  const legacy = useRef(settings);
  const bridge = getDesktopBridge()?.assistant;
  const nativeKeys = !!bridge?.getApiKey && !!bridge?.setApiKey;
  const migrationDone = useRef(!nativeKeys || !legacy.current.apiKey);
  const initialization = useRef<Promise<void>>();
  const legacyKeyUpdate = useRef<Promise<void>>();
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
      .then(key => {
        if (cancelled || keyEpoch.current !== epoch) return;
        current.current = { ...current.current, apiKey: key ?? '' };
        setSettings(current.current);
      })
      .catch(() => {
        if (!cancelled)
          setStorageError(
            'Could not unlock or save the API key in the OS credential store. Unlock your system keyring and restart Robo-Boy. An existing browser key is retained until migration succeeds.'
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
      const provider = current.current.provider;
      setStorageError('');
      const saved = bridge!.setApiKey!(provider, patch.apiKey);
      if (provider === legacy.current.provider) legacyKeyUpdate.current = saved;
      void saved
        .then(() => {
          // An explicitly re-entered key can complete migration after a previously locked keyring.
          // Never let a stale legacy browser record overwrite that new native key on restart.
          if (!migrationDone.current && provider === legacy.current.provider) {
            migrationDone.current = true;
            initialization.current = Promise.resolve();
            if (mounted.current) persist();
          }
        })
        .catch(() => {
          if (mounted.current)
            setStorageError(
              'The API key is kept for this session but could not be saved securely. Unlock your system keyring and enter the key again.'
            );
        });
    }
  };
  return { settings, updateSettings, storageError, loadingCredentials };
}
