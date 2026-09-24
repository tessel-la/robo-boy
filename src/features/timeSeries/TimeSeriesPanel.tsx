import { FiMenu } from 'react-icons/fi';
import { useCallback, useEffect, useRef, useState } from 'react';
import ROSLIB, { type Ros } from 'roslib';
import type { RoboBoyJsonObject } from '../../panels/types';
import { getDesiredSources, sanitizeConfig, type TimeseriesConfig } from './config';
import { TimeSeriesEngine } from './engine';
import { SubscriptionController } from './subscriptions';
import TimeSeriesPlot from './TimeSeriesPlot';
import TimeSeriesSettings from './TimeSeriesSettings';
import '../treePanel/components/TreePanelChrome.css';
import './TimeSeriesPanel.css';

interface Props {
  ros: Ros | null;
  connected: boolean;
  connectionGeneration: number;
  isActive: boolean;
  state?: RoboBoyJsonObject;
  onStateChange: (values: RoboBoyJsonObject) => void;
  /** Sample timestamps in epoch milliseconds; replay passes the recording's clock. */
  clock?: () => number;
}
export default function TimeSeriesPanel({
  ros,
  connected,
  connectionGeneration,
  isActive,
  state,
  onStateChange,
  clock = Date.now,
}: Props) {
  const [engine] = useState(() => new TimeSeriesEngine(sanitizeConfig(state?.config)));
  const [config, setConfig] = useState(engine.config);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [intersecting, setIntersecting] = useState(true);
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  const saveRef = useRef(onStateChange);
  saveRef.current = onStateChange;
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const controllerRef = useRef<SubscriptionController | null>(null);
  const closeSettings = () => {
    setSettings(false);
    requestAnimationFrame(() => settingsButtonRef.current?.focus());
  };
  useEffect(() => {
    if (contentRef.current) contentRef.current.inert = settings;
  }, [settings]);
  const active = isActive && visible && intersecting;
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !rootRef.current) return;
    const observer = new IntersectionObserver(entries => setIntersecting(entries[0]?.isIntersecting ?? false));
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  const save = useCallback(
    (next: TimeseriesConfig) => {
      engine.configure(next);
      setConfig(next);
      saveRef.current({ config: next as unknown as RoboBoyJsonObject });
      controllerRef.current?.reconcile(getDesiredSources(next));
    },
    [engine]
  );
  useEffect(() => {
    // Applying a saved layout can replace settings without changing a tile's React key.
    if (!state?.config || state.config === (engine.config as unknown)) return;
    const restored = sanitizeConfig(state.config);
    if (JSON.stringify(restored) === JSON.stringify(engine.config)) return;
    engine.configure(restored);
    setConfig(restored);
    controllerRef.current?.reconcile(getDesiredSources(restored));
  }, [state?.config, engine]);

  useEffect(() => {
    if (!ros || !connected || !active) return;
    engine.reconnect();
    setError('');
    const controller = new SubscriptionController(
      async (source, listener) => {
        const topic = new ROSLIB.Topic({
          ros,
          name: source.topic,
          messageType: source.messageType,
          throttle_rate: source.throttleMs,
          queue_length: 1,
          reconnect_on_close: false,
        });
        // ROSLIB 1.x assigns ros.callOnConnection without binding it when automatic
        // reconnect is off. Keep lifecycle ownership here and restore its receiver.
        topic.callForSubscribeAndAdvertise = topic.callForSubscribeAndAdvertise.bind(ros);
        try {
          topic.subscribe(listener);
        } catch (error) {
          topic.unsubscribe();
          throw error;
        }
        return {
          unsubscribe: async () => {
            topic.unsubscribe();
          },
        };
      },
      (source, message) => {
        const next = engine.receive(source, message, clockRef.current());
        if (next) {
          setConfig({ ...next });
          saveRef.current({ config: next as unknown as RoboBoyJsonObject });
          controller.reconcile(getDesiredSources(next));
        }
      },
      (source, reason) => setError(`${source.topic}: ${reason instanceof Error ? reason.message : String(reason)}`)
    );
    controllerRef.current = controller;
    controller.reconcile(getDesiredSources(engine.config));
    return () => {
      controllerRef.current = null;
      controller.dispose();
    };
  }, [ros, connected, connectionGeneration, active, engine]);
  return (
    <section ref={rootRef} className="timeseries-panel" aria-label="Time Series">
      <div ref={contentRef} className="timeseries-content" aria-hidden={settings || undefined}>
        <header className="timeseries-header">
          <button
            className="tree-panel-menu-button"
            ref={settingsButtonRef}
            aria-label="Settings"
            aria-expanded={settings}
            onClick={() => setSettings(open => !open)}
            title={`Signals and settings · ${connected ? (active ? 'Connected' : 'Inactive') : 'Disconnected'}`}
          >
            <FiMenu className="tree-panel-menu-icon" aria-hidden="true" />
            <span>Signals · {config.series.length}</span>
            <span
              className="timeseries-connection"
              data-connected={connected && active}
              role="status"
              aria-label={connected ? (active ? 'Connected' : 'Inactive') : 'Disconnected'}
            />
          </button>
        </header>
        {error && (
          <p className="timeseries-error" role="alert">
            {error}
          </p>
        )}
        <TimeSeriesPlot
          engine={engine}
          config={config}
          active={active}
          onOpenSettings={() => setSettings(true)}
          onToggle={id =>
            save({
              ...engine.config,
              series: engine.config.series.map(s => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
            })
          }
        />
      </div>
      {settings && (
        <TimeSeriesSettings
          engine={engine}
          config={config}
          ros={ros}
          connected={connected}
          onChange={save}
          onClose={closeSettings}
        />
      )}
    </section>
  );
}
