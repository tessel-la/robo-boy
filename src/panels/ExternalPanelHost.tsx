import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import { version as roboBoyVersion } from '../../package.json';
import { loadExternalPanelDefinition } from './loader';
import type {
  PanelModuleImporter,
  ResolvedPanelManifest,
  RoboBoyJsonObject,
  RoboBoyJsonValue,
  RoboBoyPanelContext,
  RoboBoyPanelInstance,
  RoboBoyPanelLogger,
  RoboBoyPanelStorage,
} from './types';
import './ExternalPanelHost.css';

interface ExternalPanelHostProps {
  manifest: ResolvedPanelManifest;
  instanceId: string;
  ros: Ros | null;
  isActive: boolean;
  state?: RoboBoyJsonObject;
  onStateChange: (state: RoboBoyJsonObject) => void;
  importer?: PanelModuleImporter;
}

type HostStatus = { phase: 'loading' } | { phase: 'ready' } | { phase: 'error'; message: string };

const createLogger = (panelId: string, instanceId: string): RoboBoyPanelLogger => {
  const prefix = `[external panel ${panelId}:${instanceId}]`;
  return {
    debug: (message, ...details) => console.debug(prefix, message, ...details),
    info: (message, ...details) => console.info(prefix, message, ...details),
    warn: (message, ...details) => console.warn(prefix, message, ...details),
    error: (message, ...details) => console.error(prefix, message, ...details),
  };
};

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const ExternalPanelHost = ({
  manifest,
  instanceId,
  ros,
  isActive,
  state = {},
  onStateChange,
  importer,
}: ExternalPanelHostProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<RoboBoyPanelInstance | null>(null);
  const cleanupRef = useRef<(() => Promise<void>) | null>(null);
  const stateRef = useRef<RoboBoyJsonObject>(state);
  const onStateChangeRef = useRef(onStateChange);
  const [status, setStatus] = useState<HostStatus>({ phase: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const capabilities = useMemo(() => manifest.capabilities || [], [manifest.capabilities]);
  const logger = useMemo(() => createLogger(manifest.id, instanceId), [instanceId, manifest.id]);
  const failPanel = useCallback(
    (message: string, error: unknown) => {
      logger.error(message, error);
      const cleanup = cleanupRef.current;
      cleanupRef.current = null;
      if (cleanup) void cleanup();
      containerRef.current?.replaceChildren();
      setStatus({ phase: 'error', message: getErrorMessage(error) });
    },
    [logger]
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    let disposed = false;
    let effectCleanup: (() => Promise<void>) | null = null;
    const container = containerRef.current;
    if (!container) return;

    container.replaceChildren();
    setStatus({ phase: 'loading' });

    const storage: RoboBoyPanelStorage | null = capabilities.includes('storage')
      ? {
          get: <T extends RoboBoyJsonValue>(key: string, fallback: T): T => {
            const value = stateRef.current[key];
            return value === undefined ? fallback : (value as T);
          },
          set: (key, value) => {
            const nextState = { ...stateRef.current, [key]: value };
            stateRef.current = nextState;
            onStateChangeRef.current(nextState);
          },
          remove: key => {
            const nextState = { ...stateRef.current };
            delete nextState[key];
            stateRef.current = nextState;
            onStateChangeRef.current(nextState);
          },
        }
      : null;

    const context: RoboBoyPanelContext = {
      panelId: manifest.id,
      instanceId,
      hostVersion: roboBoyVersion,
      capabilities,
      ros: capabilities.includes('ros') ? ros : null,
      storage,
      logger,
    };

    const start = async () => {
      try {
        const definition = await loadExternalPanelDefinition(manifest, importer);
        const instance = await definition.activate(context);
        if (!instance || typeof instance.mount !== 'function') {
          throw new Error(`${manifest.name} activation did not return a mountable panel instance.`);
        }
        let cleanedUp = false;
        effectCleanup = async () => {
          if (cleanedUp) return;
          cleanedUp = true;
          if (instanceRef.current === instance) instanceRef.current = null;
          try {
            await instance.unmount?.();
          } catch (error) {
            logger.error('Panel cleanup failed.', error);
          }
        };
        cleanupRef.current = effectCleanup;
        if (disposed) {
          cleanupRef.current = null;
          await effectCleanup();
          return;
        }
        instanceRef.current = instance;
        await instance.mount(container);
        if (disposed) {
          cleanupRef.current = null;
          await effectCleanup();
          return;
        }
        await instance.setActive?.(isActive);
        setStatus({ phase: 'ready' });
      } catch (error) {
        if (disposed) return;
        failPanel('Panel lifecycle failed.', error);
      }
    };

    void start();

    return () => {
      disposed = true;
      container.replaceChildren();
      if (effectCleanup && cleanupRef.current === effectCleanup) {
        cleanupRef.current = null;
        void effectCleanup();
      }
    };
  }, [capabilities, failPanel, importer, instanceId, logger, manifest, retryKey, ros]);

  useEffect(() => {
    const isAttributedToPanel = (error: unknown, filename?: string) => {
      if (filename === manifest.entryPoint) return true;
      const stack = error instanceof Error ? error.stack : undefined;
      return Boolean(stack?.includes(manifest.entryPoint));
    };
    const handleError = (event: ErrorEvent) => {
      if (!isAttributedToPanel(event.error, event.filename)) return;
      event.preventDefault();
      failPanel('Panel runtime failed.', event.error || event.message);
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isAttributedToPanel(event.reason)) return;
      event.preventDefault();
      failPanel('Panel runtime promise failed.', event.reason);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [failPanel, manifest.entryPoint]);

  useEffect(() => {
    if (!instanceRef.current?.setActive) return;
    Promise.resolve(instanceRef.current.setActive(isActive)).catch(error => {
      failPanel('Panel active-state update failed.', error);
    });
  }, [failPanel, isActive]);

  return (
    <div className="external-panel-host" data-panel-id={manifest.id}>
      <div ref={containerRef} className="external-panel-mount" />
      {status.phase === 'loading' && (
        <div className="external-panel-status" role="status">
          Loading {manifest.name}…
        </div>
      )}
      {status.phase === 'error' && (
        <div className="external-panel-status external-panel-error" role="alert">
          <strong>{manifest.name} could not start</strong>
          <span>{status.message}</span>
          <button type="button" onClick={() => setRetryKey(value => value + 1)}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
};

export default ExternalPanelHost;
