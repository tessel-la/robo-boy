import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import { version as roboBoyVersion } from '../../package.json';
import { loadExternalPanelDefinition } from './loader';
import {
  PANEL_STORAGE_QUOTA_BYTES,
  PANEL_STORAGE_SCHEMA_VERSION,
  getPanelStateSizeBytes,
  removePanelStateValue,
  setPanelStateValue,
  validatePanelStorageKey,
} from './storage';
import type {
  PanelModuleImporter,
  ResolvedPanelManifest,
  RoboBoyJsonObject,
  RoboBoyJsonValue,
  RoboBoyPanelConnection,
  RoboBoyPanelConnectionSnapshot,
  RoboBoyPanelContext,
  RoboBoyPanelInstance,
  RoboBoyPanelLogger,
  RoboBoyPanelRuntime,
  RoboBoyPanelStorage,
  RoboBoyPanelViewport,
  RoboBoyPanelViewportSnapshot,
} from './types';
import './ExternalPanelHost.css';

interface ExternalPanelHostProps {
  manifest: ResolvedPanelManifest;
  instanceId: string;
  ros: Ros | null;
  connectionStatus: RoboBoyPanelConnectionSnapshot['status'];
  connectionGeneration: number;
  runtime: RoboBoyPanelRuntime;
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

const getInitialViewportSnapshot = (isActive: boolean): RoboBoyPanelViewportSnapshot => {
  const isDocumentVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  return { width: 0, height: 0, isIntersecting: true, isDocumentVisible, isActive: isActive && isDocumentVisible };
};

const ExternalPanelHost = ({
  manifest,
  instanceId,
  ros,
  connectionStatus,
  connectionGeneration,
  runtime,
  isActive,
  state = {},
  onStateChange,
  importer,
}: ExternalPanelHostProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<RoboBoyPanelInstance | null>(null);
  const cleanupRef = useRef<(() => Promise<void>) | null>(null);
  const stateRef = useRef<RoboBoyJsonObject>(state);
  const onStateChangeRef = useRef(onStateChange);
  const isActiveRef = useRef(isActive);
  const connectionSnapshotRef = useRef<RoboBoyPanelConnectionSnapshot>({
    status: connectionStatus,
    generation: connectionGeneration,
  });
  const connectionListenersRef = useRef(new Set<(snapshot: RoboBoyPanelConnectionSnapshot) => void>());
  const viewportSnapshotRef = useRef<RoboBoyPanelViewportSnapshot>(getInitialViewportSnapshot(isActive));
  const viewportListenersRef = useRef(new Set<(snapshot: RoboBoyPanelViewportSnapshot) => void>());
  const [effectiveActive, setEffectiveActive] = useState(viewportSnapshotRef.current.isActive);
  const [status, setStatus] = useState<HostStatus>({ phase: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const capabilities = useMemo(() => manifest.capabilities || [], [manifest.capabilities]);
  const panelRos = capabilities.includes('ros') ? ros : null;
  const logger = useMemo(() => createLogger(manifest.id, instanceId), [instanceId, manifest.id]);

  const connection = useMemo<RoboBoyPanelConnection>(
    () => ({
      getSnapshot: () => connectionSnapshotRef.current,
      subscribe: listener => {
        connectionListenersRef.current.add(listener);
        return () => connectionListenersRef.current.delete(listener);
      },
    }),
    []
  );

  const viewport = useMemo<RoboBoyPanelViewport>(
    () => ({
      getSnapshot: () => viewportSnapshotRef.current,
      subscribe: listener => {
        viewportListenersRef.current.add(listener);
        return () => viewportListenersRef.current.delete(listener);
      },
      requestFullscreen: async () => {
        const host = hostRef.current;
        if (!host?.requestFullscreen) throw new Error('Fullscreen is unavailable for this panel host.');
        await host.requestFullscreen();
      },
    }),
    []
  );

  const publishViewport = useCallback((update: Partial<RoboBoyPanelViewportSnapshot>) => {
    const merged = { ...viewportSnapshotRef.current, ...update };
    const next = {
      ...merged,
      isActive: isActiveRef.current && merged.isIntersecting && merged.isDocumentVisible,
    };
    const previous = viewportSnapshotRef.current;
    if (
      previous.width === next.width &&
      previous.height === next.height &&
      previous.isIntersecting === next.isIntersecting &&
      previous.isDocumentVisible === next.isDocumentVisible &&
      previous.isActive === next.isActive
    ) {
      return;
    }
    viewportSnapshotRef.current = next;
    setEffectiveActive(next.isActive);
    viewportListenersRef.current.forEach(listener => listener(next));
  }, []);

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
    const next = { status: connectionStatus, generation: connectionGeneration } as const;
    const previous = connectionSnapshotRef.current;
    if (previous.status === next.status && previous.generation === next.generation) return;
    connectionSnapshotRef.current = next;
    connectionListenersRef.current.forEach(listener => listener(next));
  }, [connectionGeneration, connectionStatus]);

  useEffect(() => {
    isActiveRef.current = isActive;
    publishViewport({});
  }, [isActive, publishViewport]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const updateSize = () => {
      const bounds = host.getBoundingClientRect();
      publishViewport({ width: Math.max(0, bounds.width), height: Math.max(0, bounds.height) });
    };
    const updateDocumentVisibility = () => {
      publishViewport({ isDocumentVisible: document.visibilityState !== 'hidden' });
    };
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(entries => {
            const bounds = entries[0]?.contentRect;
            if (bounds) publishViewport({ width: Math.max(0, bounds.width), height: Math.max(0, bounds.height) });
          });
    const intersectionObserver =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(entries => {
            publishViewport({ isIntersecting: entries[0]?.isIntersecting ?? false });
          });

    updateSize();
    updateDocumentVisibility();
    resizeObserver?.observe(host);
    intersectionObserver?.observe(host);
    document.addEventListener('visibilitychange', updateDocumentVisibility);
    if (!resizeObserver) window.addEventListener('resize', updateSize);

    return () => {
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener('visibilitychange', updateDocumentVisibility);
      if (!resizeObserver) window.removeEventListener('resize', updateSize);
    };
  }, [publishViewport]);

  useEffect(() => {
    let disposed = false;
    let effectCleanup: (() => Promise<void>) | null = null;
    const container = containerRef.current;
    if (!container) return;

    container.replaceChildren();
    setStatus({ phase: 'loading' });

    const storage: RoboBoyPanelStorage | null = capabilities.includes('storage')
      ? {
          schemaVersion: PANEL_STORAGE_SCHEMA_VERSION,
          quotaBytes: PANEL_STORAGE_QUOTA_BYTES,
          get: <T extends RoboBoyJsonValue>(key: string, fallback: T): T => {
            validatePanelStorageKey(key);
            const value = stateRef.current[key];
            return value === undefined ? fallback : (value as T);
          },
          set: (key, value) => {
            const nextState = setPanelStateValue(stateRef.current, key, value);
            stateRef.current = nextState;
            onStateChangeRef.current(nextState);
          },
          remove: key => {
            const nextState = removePanelStateValue(stateRef.current, key);
            stateRef.current = nextState;
            onStateChangeRef.current(nextState);
          },
          sizeBytes: () => getPanelStateSizeBytes(stateRef.current),
        }
      : null;

    const context: RoboBoyPanelContext = {
      panelId: manifest.id,
      instanceId,
      hostVersion: roboBoyVersion,
      capabilities,
      ros: panelRos,
      storage,
      runtime,
      connection,
      viewport,
      logger,
    };

    const start = async () => {
      try {
        const definition = await loadExternalPanelDefinition(manifest, importer);
        const instance = await definition.activate(context);
        if (!instance || typeof instance.mount !== 'function' || typeof instance.unmount !== 'function') {
          throw new Error(`${manifest.name} activation must return mount and unmount lifecycle functions.`);
        }
        let cleanedUp = false;
        effectCleanup = async () => {
          if (cleanedUp) return;
          cleanedUp = true;
          if (instanceRef.current === instance) instanceRef.current = null;
          try {
            await instance.unmount();
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
        await instance.setActive?.(viewport.getSnapshot().isActive);
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
  }, [
    capabilities,
    connection,
    failPanel,
    importer,
    instanceId,
    logger,
    manifest,
    panelRos,
    retryKey,
    runtime,
    viewport,
  ]);

  useEffect(() => {
    const attributedUrls = [
      manifest.entryPoint,
      ...(manifest.assets || []).map(asset => new URL(asset.path, manifest.entryPoint).href),
    ];
    const isAttributedToPanel = (error: unknown, filename?: string) => {
      if (filename && attributedUrls.some(url => filename === url || filename.startsWith(url))) return true;
      const stack = error instanceof Error ? error.stack : undefined;
      return Boolean(stack && attributedUrls.some(url => stack.includes(url)));
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
  }, [failPanel, manifest.assets, manifest.entryPoint]);

  useEffect(() => {
    if (!instanceRef.current?.setActive) return;
    Promise.resolve(instanceRef.current.setActive(effectiveActive)).catch(error => {
      failPanel('Panel active-state update failed.', error);
    });
  }, [effectiveActive, failPanel]);

  return (
    <div ref={hostRef} className="external-panel-host" data-panel-id={manifest.id}>
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
