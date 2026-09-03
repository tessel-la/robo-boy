import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import { connectPanelCapabilityBroker, getGrantedPanelEndpoints } from './capabilityBroker';
import { ROBOBOY_PANEL_API_VERSION } from './constants';
import { loadExternalPanelSource } from './localPanels';
import { PANEL_STORAGE_QUOTA_BYTES, PANEL_STORAGE_SCHEMA_VERSION, validatePanelState } from './storage';
import { readPanelTheme } from './theme';
import type { PanelHostToSandboxMessage, PanelSandboxToHostMessage } from './sandboxProtocol';
import type {
  PanelHostRuntime,
  ResolvedPanelManifest,
  RoboBoyJsonObject,
  RoboBoyPanelConnectionSnapshot,
  RoboBoyPanelLogger,
  RoboBoyPanelThemeSnapshot,
  RoboBoyPanelViewportSnapshot,
  RoboBoyRosTopic,
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
  approvedRosTopics?: readonly RoboBoyRosTopic[];
  onApprovedRosTopicsChange?: (topics: RoboBoyRosTopic[]) => void;
  sourceLoader?: (manifest: ResolvedPanelManifest) => Promise<string>;
}

type HostStatus = { phase: 'loading' } | { phase: 'ready' } | { phase: 'error'; message: string };
type TopicPickerState = { topics: RoboBoyRosTopic[]; selectedTopic: string; query: string };

const PANEL_START_TIMEOUT_MS = 20_000;
// The probe retries until the sandbox answers, so without a deadline a sandbox that never runs
// leaves the panel on its loading overlay forever, with nothing reported to the user or the log.
const SANDBOX_HANDSHAKE_TIMEOUT_MS = 10_000;
const NO_APPROVED_ROS_TOPICS: readonly RoboBoyRosTopic[] = [];

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
  approvedRosTopics = NO_APPROVED_ROS_TOPICS,
  onApprovedRosTopicsChange,
  sourceLoader = loadExternalPanelSource,
}: ExternalPanelHostProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | null>(null);
  const sandboxCleanupRef = useRef<(() => void) | null>(null);
  const viewportRef = useRef<RoboBoyPanelViewportSnapshot>(getInitialViewportSnapshot(isActive));
  const themeRef = useRef<RoboBoyPanelThemeSnapshot>({ colorScheme: 'light', tokens: {} });
  const selectedRosTopicsRef = useRef(new Map(approvedRosTopics.map(topic => [topic.name, topic.messageType])));
  const topicPickerPromiseRef = useRef<{
    resolve(topic: RoboBoyRosTopic): void;
    reject(error: Error): void;
  } | null>(null);
  const isActiveRef = useRef(isActive);
  const stateRef = useRef(state);
  const onStateChangeRef = useRef(onStateChange);
  const onApprovedRosTopicsChangeRef = useRef(onApprovedRosTopicsChange);
  const [status, setStatus] = useState<HostStatus>({ phase: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const [topicPicker, setTopicPicker] = useState<TopicPickerState | null>(null);
  const panelRevision = `${manifest.id}:${manifest.version}:${manifest.integrity}`;
  const capabilities = useMemo(() => manifest.capabilities || [], [manifest.capabilities]);
  const logger = useMemo(() => createLogger(manifest.id, instanceId), [instanceId, manifest.id]);
  // Served from its own URL, so the sandbox carries its own CSP instead of inheriting the host's.
  const sandboxUrl = useMemo(() => {
    const url = new URL('panel-sandbox.html', document.baseURI);
    url.searchParams.set('parentOrigin', window.location.origin);
    return url.href;
  }, []);
  const filteredTopicOptions = useMemo(() => {
    if (!topicPicker) return [];
    const query = topicPicker.query.trim().toLowerCase();
    return query
      ? topicPicker.topics.filter(
          topic => topic.name.toLowerCase().includes(query) || topic.messageType.toLowerCase().includes(query)
        )
      : topicPicker.topics;
  }, [topicPicker]);

  const post = useCallback((message: PanelHostToSandboxMessage) => portRef.current?.postMessage(message), []);
  const cancelTopicSelection = useCallback((message = 'ROS topic selection was cancelled.') => {
    if (!topicPickerPromiseRef.current) return;
    topicPickerPromiseRef.current.reject(new Error(message));
    topicPickerPromiseRef.current = null;
    setTopicPicker(null);
  }, []);
  const requestRosTopicSelection = useCallback(
    (topics: RoboBoyRosTopic[], currentTopic?: string) =>
      new Promise<RoboBoyRosTopic>((resolve, reject) => {
        topicPickerPromiseRef.current?.reject(new Error('A newer ROS topic selection replaced this request.'));
        const sorted = [...topics].sort((left, right) => left.name.localeCompare(right.name));
        topicPickerPromiseRef.current = { resolve, reject };
        setTopicPicker({
          topics: sorted,
          selectedTopic: sorted.some(topic => topic.name === currentTopic) ? currentTopic! : '',
          query: '',
        });
      }),
    []
  );
  const approveTopicSelection = useCallback(() => {
    if (!topicPicker?.selectedTopic || !topicPickerPromiseRef.current) return;
    const selected = topicPicker.topics.find(topic => topic.name === topicPicker.selectedTopic);
    if (!selected) return;
    const pending = topicPickerPromiseRef.current;
    topicPickerPromiseRef.current = null;
    setTopicPicker(null);
    pending.resolve(selected);
  }, [topicPicker]);
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
    onApprovedRosTopicsChangeRef.current = onApprovedRosTopicsChange;
  }, [onApprovedRosTopicsChange]);

  useEffect(() => {
    selectedRosTopicsRef.current.clear();
    approvedRosTopics.forEach(topic => selectedRosTopicsRef.current.set(topic.name, topic.messageType));
  }, [approvedRosTopics]);

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
    const publishTheme = () => {
      const next = readPanelTheme(host);
      themeRef.current = next;
      post({ type: 'theme', value: next });
    };
    publishTheme();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(publishTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    return () => observer.disconnect();
  }, [post]);

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
    cancelTopicSelection('Panel reloaded before ROS topic selection completed.');
    let disposed = false;
    let disconnectBroker: (() => void) | null = null;
    let startupSettled = false;
    let startupTimer: number | null = null;
    const channel = new MessageChannel();
    const iframe = iframeRef.current;
    const host = hostRef.current;
    if (!iframe?.contentWindow || !host) return;
    themeRef.current = readPanelTheme(host);
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
        requestRosTopicSelection,
        userSelectedRosTopics: selectedRosTopicsRef.current,
        onRosTopicSelected: selected => {
          const next = [...selectedRosTopicsRef.current.entries()]
            .map(([name, messageType]) => ({ name, messageType }))
            .sort((left, right) => left.name.localeCompare(right.name));
          onApprovedRosTopicsChangeRef.current?.(next);
        },
        logger,
      },
      handleMessage
    );
    // The sandbox has an intentionally opaque origin, so '*' is required when
    // transferring its private port. The sandbox authenticates this parent by
    // both event.source and the parent origin embedded in its srcdoc.
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
            theme: themeRef.current,
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
    cancelTopicSelection,
    connectionGeneration,
    connectionStatus,
    instanceId,
    logger,
    manifest,
    post,
    ros,
    runtime,
    requestRosTopicSelection,
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
      // An opaque-origin iframe can only be targeted with '*'. The probe carries
      // no authority, and the sandbox accepts it only from this parent origin.
      iframeRef.current?.contentWindow?.postMessage({ type: 'roboboy-panel-sandbox-probe' }, '*');
      probeTimer = window.setTimeout(probe, connectedSessionId ? 1_000 : 250);
    };
    let handshakeTimer: number | null = window.setTimeout(() => {
      handshakeTimer = null;
      stopProbing();
      logger.error('Panel sandbox failed.', 'The panel sandbox never reported that it started.');
      setStatus({ phase: 'error', message: 'The panel sandbox did not start.' });
    }, SANDBOX_HANDSHAKE_TIMEOUT_MS);
    const clearHandshakeDeadline = () => {
      if (handshakeTimer !== null) window.clearTimeout(handshakeTimer);
      handshakeTimer = null;
    };
    const handleSandboxReady = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow;
      if (
        !iframeWindow ||
        event.source !== iframeWindow ||
        event.origin !== 'null' ||
        event.data?.type !== 'roboboy-panel-sandbox-ready' ||
        typeof event.data.sessionId !== 'string' ||
        event.data.sessionId === connectedSessionId
      ) {
        return;
      }
      const isReload = connectedSessionId !== null;
      clearHandshakeDeadline();
      connectedSessionId = event.data.sessionId;
      if (isReload) setStatus({ phase: 'loading' });
      connectSandboxRef.current();
    };

    window.addEventListener('message', handleSandboxReady);
    probe();
    return () => {
      stopProbing();
      clearHandshakeDeadline();
      window.removeEventListener('message', handleSandboxReady);
    };
  }, [logger, panelRevision, retryKey]);

  useEffect(
    () => () => {
      sandboxCleanupRef.current?.();
      sandboxCleanupRef.current = null;
      cancelTopicSelection('Panel closed before ROS topic selection completed.');
    },
    [cancelTopicSelection]
  );

  return (
    <div ref={hostRef} className="external-panel-host" data-panel-id={manifest.id}>
      <iframe
        key={`${panelRevision}:${retryKey}`}
        ref={iframeRef}
        className="external-panel-sandbox"
        title={manifest.name}
        sandbox="allow-scripts allow-downloads allow-forms"
        allow={getIframeAllow(capabilities)}
        referrerPolicy="no-referrer"
        src={sandboxUrl}
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
      {topicPicker && (
        <div className="external-panel-topic-picker-backdrop">
          <section
            className="external-panel-topic-picker"
            role="dialog"
            aria-modal="true"
            aria-label="Choose ROS topic"
          >
            <header>
              <div>
                <span className="external-panel-topic-picker-kicker">User-approved ROS access</span>
                <h3>Choose a topic for {manifest.name}</h3>
              </div>
              <button type="button" onClick={() => cancelTopicSelection()} aria-label="Cancel ROS topic selection">
                ×
              </button>
            </header>
            <p>The panel receives only the topic and message type you approve here.</p>
            <label>
              Search topics
              <input
                value={topicPicker.query}
                onChange={event =>
                  setTopicPicker(previous => (previous ? { ...previous, query: event.target.value } : null))
                }
                placeholder="/joint_states or sensor_msgs…"
                autoFocus
              />
            </label>
            <label>
              Available topics
              <select
                size={Math.min(9, Math.max(3, filteredTopicOptions.length))}
                value={topicPicker.selectedTopic}
                onChange={event =>
                  setTopicPicker(previous => (previous ? { ...previous, selectedTopic: event.target.value } : null))
                }
              >
                {filteredTopicOptions.map(topic => (
                  <option key={`${topic.name}:${topic.messageType}`} value={topic.name}>
                    {topic.name} · {topic.messageType || 'unknown type'}
                  </option>
                ))}
              </select>
            </label>
            {filteredTopicOptions.length === 0 && (
              <span className="external-panel-topic-picker-empty">No matching topics</span>
            )}
            <footer>
              <button type="button" onClick={() => cancelTopicSelection()}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={!topicPicker.selectedTopic}
                onClick={approveTopicSelection}
              >
                Allow selected topic
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
};

export default ExternalPanelHost;
