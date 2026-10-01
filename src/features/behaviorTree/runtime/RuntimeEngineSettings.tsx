import React, { useState } from 'react';
import type { useRemoteTreeRuntime } from './useRemoteTreeRuntime';
import { treeFormats } from './xml';

export default function RuntimeEngineSettings({ runtime }: { runtime: ReturnType<typeof useRemoteTreeRuntime> }) {
  const { client, state } = runtime;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="bt-menu-section bt-engine-settings">
      <label className="bt-menu-label">Execution engines · ROS host</label>
      {treeFormats.map(format => {
        const descriptor = state.runtimes.find(r => r.id === format.id);
        return (
          <div className="bt-engine-row" key={format.id}>
            <label className={`bt-persistent-toggle${descriptor && descriptor.enabled !== false ? ' active' : ''}`}>
              <input
                type="checkbox"
                role="switch"
                aria-label={`Enable ${format.label}`}
                checked={!!descriptor && descriptor.enabled !== false}
                disabled={busy || !state.connected || (!descriptor?.available && !state.observations?.some(item => item.runtime === format.id))}
                onChange={async event => {
                  setBusy(true);
                  setError(null);
                  try {
                    await client?.setEnabled(format.id, event.target.checked);
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <span className="bt-persistent-toggle-track" aria-hidden="true">
                <span />
              </span>
              <span>{format.label}</span>
            </label>
            <small title={descriptor?.reason}>
              {!state.connected
                ? client
                  ? 'Host executor unavailable'
                  : 'Connect to ROS to configure'
                : descriptor?.available
                  ? `${descriptor.version || ''} · ${descriptor.enabled === false ? 'Disabled' : 'Enabled'}`
                  : state.observations.some(item => item.runtime === format.id)
                    ? `${descriptor?.enabled === false ? 'Monitoring off' : 'Monitoring enabled'} · Execution unavailable`
                    : descriptor?.reason || 'Unavailable on host'}
            </small>
          </div>
        );
      })}
      <p className="bt-menu-hint">
        Disabled engines are hidden from the toolbar. Turning one off stops trees run by Robo Boy and pauses external monitoring. Independently running robot trees keep executing.
        Settings apply to this host until its executor restarts.
      </p>
      <button
        className="bt-menu-action-btn"
        disabled={busy || !client}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await client?.discover();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Discover engines
      </button>
      {(error || state.error) && (
        <p role="alert" className="bt-native-error">
          {error || state.error}
        </p>
      )}
    </div>
  );
}
