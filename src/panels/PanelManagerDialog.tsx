import { useEffect, useMemo, useState } from 'react';
import { FiPlus, FiTrash2, FiX } from 'react-icons/fi';
import {
  applyPanelManagerPlan,
  loadPanelManagerConfig,
  previewPanelManagerConfig,
  type PanelInstallPreview,
  type PanelSourceConfig,
  type PanelSourcesConfig,
} from './managerApi';
import type { ResolvedPanelManifest, RoboBoyPanelManifest } from './types';
import './PanelManagerDialog.css';

interface PanelManagerDialogProps {
  installedPanels: ResolvedPanelManifest[];
  onClose: () => void;
  onApplied: () => Promise<void> | void;
}

const splitLines = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean);

const permissionSummary = (panel: RoboBoyPanelManifest): string[] => {
  const summary: string[] = [];
  const ros = panel.permissions?.ros;
  const network = panel.permissions?.network;
  if (panel.capabilities?.includes('storage')) summary.push('64 KiB workspace storage');
  if (ros?.discover) summary.push('discover approved ROS topics');
  if (ros?.subscribe?.length) summary.push(`subscribe ROS: ${ros.subscribe.join(', ')}`);
  if (ros?.publish?.length) summary.push(`publish ROS: ${ros.publish.join(', ')}`);
  if (ros?.services?.length) summary.push(`call ROS services: ${ros.services.join(', ')}`);
  if (network?.hostEndpoints?.length) summary.push(`host endpoints: ${network.hostEndpoints.join(', ')}`);
  if (network?.origins?.length) summary.push(`network origins: ${network.origins.join(', ')}`);
  for (const capability of panel.capabilities || []) {
    if (!['storage', 'ros', 'network'].includes(capability)) summary.push(capability);
  }
  return summary.length > 0 ? summary : ['No host capabilities'];
};

const PanelManagerDialog = ({ installedPanels, onClose, onApplied }: PanelManagerDialogProps) => {
  const [token, setToken] = useState('');
  const [config, setConfig] = useState<PanelSourcesConfig | null>(null);
  const [preview, setPreview] = useState<PanelInstallPreview | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const installedIds = useMemo(() => installedPanels.map(panel => panel.id), [installedPanels]);

  useEffect(() => {
    setPreview(null);
    setReviewConfirmed(false);
    setNotice('');
  }, [config]);

  const unlock = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await loadPanelManagerConfig(token);
      setConfig(result.config);
      if (result.startupError) setNotice(`The last startup install failed: ${result.startupError}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const updateSource = (index: number, source: PanelSourceConfig) => {
    if (!config) return;
    setConfig({
      ...config,
      sources: config.sources.map((current, itemIndex) => (itemIndex === index ? source : current)),
    });
  };

  const removeSource = (index: number) => {
    if (!config) return;
    setConfig({ ...config, sources: config.sources.filter((_, itemIndex) => itemIndex !== index) });
  };

  const addSource = (type: PanelSourceConfig['type']) => {
    if (!config) return;
    const source: PanelSourceConfig =
      type === 'remote'
        ? { type, name: `remote-${config.sources.length + 1}`, catalogUrl: 'https://' }
        : { type, name: `local-${config.sources.length + 1}`, root: '/panel-workspace', repositories: [] };
    setConfig({ ...config, sources: [...config.sources, source] });
  };

  const removeInstalledPanel = (panelId: string) => {
    if (!config) return;
    const selectedIds = config.selection.mode === 'include' ? config.selection.panelIds : installedIds;
    const retained = selectedIds.filter(id => id !== panelId);
    setConfig({
      ...config,
      selection: retained.length > 0 ? { mode: 'include', panelIds: retained } : { mode: 'none' },
    });
  };

  const requestPreview = async () => {
    if (!config) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setPreview(await previewPanelManagerConfig(token, config));
      setReviewConfirmed(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const applyPreview = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const result = await applyPanelManagerPlan(token, preview.planId);
      setNotice(
        `Applied successfully. ${result.installed} external panel${result.installed === 1 ? '' : 's'} installed.`
      );
      setPreview(null);
      await onApplied();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="panel-manager-backdrop"
      role="presentation"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <section className="panel-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="panel-manager-title">
        <header>
          <div>
            <span className="panel-manager-kicker">Deployment control</span>
            <h2 id="panel-manager-title">External panels</h2>
          </div>
          <button
            type="button"
            className="panel-manager-icon-button"
            onClick={onClose}
            aria-label="Close panel manager"
          >
            <FiX aria-hidden="true" />
          </button>
        </header>

        {!config ? (
          <div className="panel-manager-unlock">
            <p>Enter the deployment token. It stays only in this dialog and is never stored by Robo-Boy.</p>
            <label>
              Panel manager token
              <input
                type="password"
                value={token}
                onChange={event => setToken(event.target.value)}
                autoComplete="off"
                onKeyDown={event => event.key === 'Enter' && void unlock()}
              />
            </label>
            <button
              type="button"
              className="panel-manager-primary"
              onClick={() => void unlock()}
              disabled={busy || !token}
            >
              {busy ? 'Checking…' : 'Unlock'}
            </button>
          </div>
        ) : (
          <div className="panel-manager-content">
            <section>
              <div className="panel-manager-section-heading">
                <div>
                  <h3>Sources</h3>
                  <p>Credentials stay in server environment variables; this form stores only their names.</p>
                </div>
                <div className="panel-manager-add-actions">
                  <button type="button" onClick={() => addSource('remote')}>
                    <FiPlus /> Remote
                  </button>
                  <button type="button" onClick={() => addSource('local')}>
                    <FiPlus /> Local
                  </button>
                </div>
              </div>
              <div className="panel-manager-sources">
                {config.sources.map((source, index) => (
                  <article key={`${source.type}-${index}`} className="panel-manager-source">
                    <div className="panel-manager-source-title">
                      <strong>{source.type === 'remote' ? 'Remote catalog' : 'Mounted workspace'}</strong>
                      <button
                        type="button"
                        className="panel-manager-icon-button"
                        onClick={() => removeSource(index)}
                        aria-label={`Remove source ${source.name}`}
                      >
                        <FiTrash2 />
                      </button>
                    </div>
                    <div className="panel-manager-fields">
                      <label>
                        Name
                        <input
                          value={source.name}
                          onChange={event => updateSource(index, { ...source, name: event.target.value })}
                        />
                      </label>
                      {source.type === 'remote' ? (
                        <>
                          <label className="wide">
                            Catalog URL
                            <input
                              value={source.catalogUrl}
                              onChange={event => updateSource(index, { ...source, catalogUrl: event.target.value })}
                            />
                          </label>
                          <label className="wide">
                            Allowed release origins
                            <textarea
                              value={(source.allowedOrigins || []).join('\n')}
                              onChange={event =>
                                updateSource(index, { ...source, allowedOrigins: splitLines(event.target.value) })
                              }
                              placeholder="https://releases.example.com"
                            />
                          </label>
                          <label>
                            Authorization environment
                            <input
                              value={source.authorizationEnv || ''}
                              onChange={event =>
                                updateSource(index, { ...source, authorizationEnv: event.target.value || undefined })
                              }
                              placeholder="ROBOBOY_PANEL_SOURCE_PRIVATE_AUTHORIZATION"
                            />
                          </label>
                          <label className="wide">
                            Credentialed origins
                            <textarea
                              value={(source.authenticatedOrigins || []).join('\n')}
                              onChange={event =>
                                updateSource(index, {
                                  ...source,
                                  authenticatedOrigins: splitLines(event.target.value),
                                })
                              }
                              placeholder="Defaults to the catalog origin"
                            />
                          </label>
                        </>
                      ) : (
                        <>
                          <label>
                            Mounted root
                            <input
                              value={source.root || ''}
                              onChange={event =>
                                updateSource(index, { ...source, root: event.target.value || undefined })
                              }
                            />
                          </label>
                          <label>
                            Root environment
                            <input
                              value={source.rootEnv || ''}
                              onChange={event =>
                                updateSource(index, { ...source, rootEnv: event.target.value || undefined })
                              }
                              placeholder="ROBOBOY_PANEL_WORKSPACE"
                            />
                          </label>
                          <label className="wide">
                            Repository directories
                            <textarea
                              value={source.repositories.join('\n')}
                              onChange={event =>
                                updateSource(index, { ...source, repositories: splitLines(event.target.value) })
                              }
                              placeholder="my-panel"
                            />
                          </label>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section>
              <div className="panel-manager-section-heading">
                <div>
                  <h3>Installed selection</h3>
                  <p>Removing a panel keeps its workspace tile unavailable so it can be restored later.</p>
                </div>
              </div>
              <div className="panel-manager-selection">
                <label>
                  Mode
                  <select
                    value={config.selection.mode}
                    onChange={event => {
                      const mode = event.target.value as 'all' | 'include' | 'none';
                      setConfig({
                        ...config,
                        selection: mode === 'include' ? { mode, panelIds: installedIds } : { mode },
                      });
                    }}
                  >
                    <option value="all">All discovered panels</option>
                    <option value="include">Only listed panel IDs</option>
                    <option value="none">No external panels</option>
                  </select>
                </label>
                {config.selection.mode === 'include' && (
                  <label className="wide">
                    Panel IDs
                    <textarea
                      value={config.selection.panelIds.join('\n')}
                      onChange={event =>
                        setConfig({
                          ...config,
                          selection: { mode: 'include', panelIds: splitLines(event.target.value) },
                        })
                      }
                    />
                  </label>
                )}
              </div>
              {installedPanels.length > 0 && (
                <ul className="panel-manager-installed">
                  {installedPanels.map(panel => (
                    <li key={panel.id}>
                      <span>
                        <strong>{panel.name}</strong>
                        <small>
                          {panel.id}@{panel.version}
                        </small>
                      </span>
                      <button type="button" onClick={() => removeInstalledPanel(panel.id)}>
                        Plan removal
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel-manager-review">
              <div className="panel-manager-section-heading">
                <div>
                  <h3>Review</h3>
                  <p>Preview verifies manifests and bundle hashes without changing the active registry.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void requestPreview()}
                  disabled={busy || config.sources.length === 0}
                >
                  {busy ? 'Verifying…' : 'Preview changes'}
                </button>
              </div>
              {preview && (
                <>
                  <div className="panel-manager-change-summary">
                    {preview.changes.length === 0
                      ? 'No installed-panel changes.'
                      : preview.changes.map(change => (
                          <span key={`${change.type}-${change.panel.id}`} data-change={change.type}>
                            {change.type} {change.panel.name}@{change.panel.version}
                          </span>
                        ))}
                  </div>
                  <div className="panel-manager-permissions">
                    {preview.panels.map(panel => (
                      <article key={panel.id}>
                        <strong>
                          {panel.name} <small>{panel.version}</small>
                        </strong>
                        <ul>
                          {permissionSummary(panel).map(item => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </div>
                  <label className="panel-manager-confirmation">
                    <input
                      type="checkbox"
                      checked={reviewConfirmed}
                      onChange={event => setReviewConfirmed(event.target.checked)}
                    />
                    I reviewed these sources and permissions and trust the selected panels with the granted data.
                  </label>
                  <button
                    type="button"
                    className="panel-manager-primary panel-manager-apply"
                    onClick={() => void applyPreview()}
                    disabled={busy || !reviewConfirmed}
                  >
                    {busy ? 'Applying…' : 'Apply this exact plan'}
                  </button>
                </>
              )}
            </section>
          </div>
        )}
        {error && (
          <div className="panel-manager-message error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="panel-manager-message" role="status">
            {notice}
          </div>
        )}
      </section>
    </div>
  );
};

export default PanelManagerDialog;
