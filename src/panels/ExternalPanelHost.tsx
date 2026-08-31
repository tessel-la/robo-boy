import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import { connectPanelCapabilityBroker, getGrantedPanelEndpoints } from './capabilityBroker';
import { ROBOBOY_PANEL_API_VERSION } from './constants';
import { loadVerifiedExternalPanelSource } from './loader';
import { createPanelSandboxDocument } from './sandboxRuntime';
import { PANEL_STORAGE_QUOTA_BYTES, PANEL_STORAGE_SCHEMA_VERSION, validatePanelState } from './storage';
import type { PanelHostToSandboxMessage, PanelSandboxToHostMessage } from './sandboxProtocol';
import type {
  PanelHostRuntime,
  ResolvedPanelManifest,
  RoboBoyJsonObject,
  RoboBoyPanelConnectionSnapshot,
  RoboBoyPanelLogger,
  RoboBoyPanelViewportSnapshot,
} from './types';
import './ExternalPanelHost.css';

interface ExternalPanelHostProps {
  manifest: ResolvedPanelManifest;
  instanceId: string;
  ros: Ros | null;
  connectionStatus: RoboBoyPanelConnectionSnapshot['status'];
  connectionGeneration: number;
  runtime: PanelHostRuntime;
  isActive: boolean;
  state?: RoboBoyJsonObject;
  onStateChange: (state: RoboBoyJsonObject) => void;
  sourceLoader?: (manifest: ResolvedPanelManifest) => Promise<string>;
}

type HostStatus = { phase: 'loading' } | { phase: 'ready' } | { phase: 'error'; message: string };

const PANEL_START_TIMEOUT_MS = 20_000;

const createLogger = (panelId: string, instanceId: string): RoboBoyPanelLogger => {
  const prefix = `[external panel ${panelId}:${instanceId}]`;
  return {
    debug: (message, ...details) => console.debug(prefix, message, ...details),
    info: (message, ...details) => console.info(prefix, message, ...details),
    warn: (message, ...details) => console.warn(prefix, message, ...details),
    error: (message, ...details) => console.error(prefix, message, ...details),
  };
};

const getInitialViewportSnapshot = (isActive: boolean): RoboBoyPanelViewportSnapshot => {
  const isDocumentVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  return { width: 0, height: 0, isIntersecting: true, isDocumentVisible, isActive: isActive && isDocumentVisible };
};

const getIframeAllow = (capabilities: readonly string[]): string | undefined => {
  const permissions = [
    capabilities.includes('camera') ? 'camera' : '',
    capabilities.includes('microphone') ? 'microphone' : '',
    capabilities.includes('web-bluetooth') ? 'bluetooth' : '',
    capabilities.includes('web-usb') ? 'usb' : '',
    capabilities.includes('web-serial') ? 'serial' : '',
  ].filter(Boolean);
  return permissions.length > 0 ? permissions.join('; ') : undefined;
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
  sourceLoader = loadVerifiedExternalPanelSource,
}: ExternalPanelHostProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const sandboxCleanupRef = useRef<(() => void) | null>(null);
  const viewportRef = useRef<RoboBoyPanelViewportSnapshot>(getInitialViewportSnapshot(isActive));
  const isActiveRef = useRef(isActive);
  const stateRef = useRef(state);
  const onStateChangeRef = useRef(onStateChange);
  const [status, setStatus] = useState<HostStatus>({ phase: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const panelRevision = `${manifest.id}:${manifest.version}:${manifest.integrity}`;
  const capabilities = useMemo(() => manifest.capabilities || [], [manifest.capabilities]);
  const logger = useMemo(() => createLogger(manifest.id, instanceId), [instanceId, manifest.id]);
  const sandboxDocument = useMemo(() => createPanelSandboxDocument(), []);

  const post = useCallback((message: PanelHostToSandboxMessage) => portRef.current?.postMessage(message), []);
  const publishViewport = useCallback(
    (update: Partial<RoboBoyPanelViewportSnapshot>) => {
      const merged = { ...viewportRef.current, ...update };
      const next = {
        ...merged,
        isActive: isActiveRef.current && merged.isIntersecting && merged.isDocumentVisible,
      };
      const previous = viewportRef.current;
      if (
        previous.width === next.width &&
        previous.height === next.height &&
        previous.isIntersecting === next.isIntersecting &&
        previous.isDocumentVisible === next.isDocumentVisible &&
        previous.isActive === next.isActive
      ) {
        return;
      }
      viewportRef.current = next;
      post({ type: 'viewport', value: next });
    },
    [post]
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    isActiveRef.current = isActive;
    publishViewport({});
  }, [isActive, publishViewport]);

  useEffect(() => {
    post({
      type: 'connection',
      value: { status: connectionStatus, generation: connectionGeneration },
    });
  }, [connectionGeneration, connectionStatus, post]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const updateSize = () => {
      const bounds = host.getBoundingClientRect();
      publishViewport({ width: Math.max(0, bounds.width), height: Math.max(0, bounds.height) });
    };
    const updateDocumentVisibility = () =>
      publishViewport({ isDocumentVisible: document.visibilityState !== 'hidden' });
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
    setStatus({ phase: 'loading' });
    portRef.current = null;
  }, [panelRevision, retryKey]);

  const connectSandbox = useCallback(() => {
    sandboxCleanupRef.current?.();
    let disposed = false;
    let disconnectBroker: (() => void) | null = null;
    let startupSettled = false;
    let startupTimer: number | null = null;
    const channel = new MessageChannel();
    const iframe = iframeRef.current;
    const host = hostRef.current;
    if (!iframe?.contentWindow || !host) return;
    portRef.current = channel.port1;

    const settleStartup = () => {
      startupSettled = true;
      if (startupTimer !== null) window.clearTimeout(startupTimer);
      startupTimer = null;
    };
    const handleMessage = (message: PanelSandboxToHostMessage) => {
      if (message.type === 'ready') {
        if (startupSettled) return;
        settleStartup();
        setStatus({ phase: 'ready' });
      } else if (message.type === 'error') {
        logger.error('Panel sandbox failed.', message.message);
        if (startupSettled) return;
        settleStartup();
        setStatus({ phase: 'error', message: message.message });
      } else if (message.type === 'log') {
        logger[message.level](message.message, ...message.details);
      } else if (message.type === 'storage') {
        if (!capabilities.includes('storage') || !validatePanelState(message.values)) {
          logger.warn('Rejected invalid panel storage update.');
          return;
        }
        stateRef.current = message.values;
        onStateChangeRef.current(message.values);
      }
    };
    disconnectBroker = connectPanelCapabilityBroker(
      channel.port1,
      {
        manifest,
        ros: capabilities.includes('ros') ? ros : null,
        runtime: { target: runtime.target },
        runtimeEndpoints: runtime.endpoints,
        hostElement: host,
        logger,
      },
      handleMessage
    );
    iframe.contentWindow.postMessage({ type: 'roboboy-panel-port' }, '*', [channel.port2]);
    startupTimer = window.setTimeout(() => {
      if (disposed || startupSettled) return;
      settleStartup();
      logger.error('Panel sandbox failed.', 'Panel startup timed out.');
      setStatus({ phase: 'error', message: 'Panel startup timed out.' });
    }, PANEL_START_TIMEOUT_MS);

    void sourceLoader(manifest)
      .then(bundleSource => {
        if (disposed) return;
        post({
          type: 'initialize',
          value: {
            panelId: manifest.id,
            instanceId,
            apiVersion: ROBOBOY_PANEL_API_VERSION,
            bundleSource,
            capabilities,
            runtime: { target: runtime.target },
            endpoints: getGrantedPanelEndpoints(manifest, runtime.endpoints),
            connection: { status: connectionStatus, generation: connectionGeneration },
            viewport: viewportRef.current,
            storage: {
              enabled: capabilities.includes('storage'),
              schemaVersion: PANEL_STORAGE_SCHEMA_VERSION,
              quotaBytes: PANEL_STORAGE_QUOTA_BYTES,
              values: stateRef.current,
            },
          },
        });
      })
      .catch(error => {
        if (disposed || startupSettled) return;
        settleStartup();
        logger.error('Panel source failed to load.', error);
        setStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
      });

    sandboxCleanupRef.current = () => {
      disposed = true;
      settleStartup();
      channel.port1.postMessage({ type: 'dispose' } satisfies PanelHostToSandboxMessage);
      disconnectBroker?.();
      if (portRef.current === channel.port1) portRef.current = null;
    };
  }, [
    capabilities,
    connectionGeneration,
    connectionStatus,
    instanceId,
    logger,
    manifest,
    post,
    ros,
    runtime,
    sourceLoader,
  ]);
  const connectSandboxRef = useRef(connectSandbox);

  useEffect(() => {
    connectSandboxRef.current = connectSandbox;
  }, [connectSandbox]);

  useEffect(() => {
    let connectedSessionId: string | null = null;
    let probeTimer: number | null = null;
    const stopProbing = () => {
      if (probeTimer !== null) window.clearTimeout(probeTimer);
      probeTimer = null;
    };
    const probe = () => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'roboboy-panel-sandbox-probe' }, '*');
      probeTimer = window.setTimeout(probe, connectedSessionId ? 1_000 : 250);
    };
    const handleSandboxReady = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (
        !iframeWindow ||
        event.source !== iframeWindow ||
        event.data?.type !== 'roboboy-panel-sandbox-ready' ||
        typeof event.data.sessionId !== 'string' ||
        event.data.sessionId === connectedSessionId
      ) {
        return;
      }
      const isReload = connectedSessionId !== null;
      connectedSessionId = event.data.sessionId;
      if (isReload) setStatus({ phase: 'loading' });
      connectSandboxRef.current();
    };

    window.addEventListener('message', handleSandboxReady);
    probe();
    return () => {
      stopProbing();
      window.removeEventListener('message', handleSandboxReady);
    };
  }, [panelRevision, retryKey]);

  useEffect(
    () => () => {
      sandboxCleanupRef.current?.();
      sandboxCleanupRef.current = null;
    },
    []
  );

  return (
    <div ref={hostRef} className="external-panel-host" data-panel-id={manifest.id}>
      <iframe
        key={`${panelRevision}:${retryKey}`}
        ref={iframeRef}
        className="external-panel-sandbox"
        title={manifest.name}
        sandbox="allow-scripts allow-downloads"
        allow={getIframeAllow(capabilities)}
        referrerPolicy="no-referrer"
        srcDoc={sandboxDocument}
      />
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
