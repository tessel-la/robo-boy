import { useEffect, useState } from 'react';
import { FiArrowUpCircle, FiCheck, FiCopy, FiServer, FiX } from 'react-icons/fi';
import { appUpdater, useAppUpdate, type UpdateSnapshot } from './appUpdater';
import { ROS_STACK_UPDATE_COMMAND } from './releases';
import { ReleaseNotes } from './ReleaseNotes';
import './AppUpdatePrompt.css';

const mib = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

const releasedAgo = (published: string) => {
  const days = Math.floor((Date.now() - Date.parse(published)) / 86_400_000);
  return Number.isNaN(days) ? '' : days <= 0 ? 'released today' : days === 1 ? 'released yesterday' : `released ${days} days ago`;
};

/** What the person is waiting on while the installer runs, which differs by system. */
const installingHint = (name?: string) =>
  name?.endsWith('.exe') ? 'The installer is taking over. Robo-Boy opens again when it is done.'
    : name?.endsWith('.dmg') ? 'Replacing Robo-Boy. It opens again in a moment.'
      : 'Your system may ask for your password to install it. Robo-Boy opens again when it is done.';

function ChangedFiles({ files }: { files: string[] }) {
  const shown = files.slice(0, 3);
  return <span className="app-update-files">{shown.join(', ')}{files.length > shown.length ? ` and ${files.length - shown.length} more` : ''}</span>;
}

function CopyCommand() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="app-update-command">
      <code>{ROS_STACK_UPDATE_COMMAND}</code>
      <button type="button" className="app-update-icon" aria-label={copied ? 'Copied' : 'Copy the update command'} title="Copy"
        onClick={() => void navigator.clipboard?.writeText(ROS_STACK_UPDATE_COMMAND).then(() => setCopied(true), () => undefined)}>
        {copied ? <FiCheck /> : <FiCopy />}
      </button>
    </div>
  );
}

function UpdateCard({ update }: { update: UpdateSnapshot }) {
  const { phase, release, installer, rosStack, progress, error, downloaded } = update;
  if (!release) {
    return (
      <>
        <header className="app-update-head">
          <span className="app-update-badge" aria-hidden="true"><FiArrowUpCircle /></span>
          <div><strong>Updates could not be checked</strong><span>{error}</span></div>
          <button type="button" className="app-update-icon" aria-label="Close" onClick={() => appUpdater.later()}><FiX /></button>
        </header>
        <div className="app-update-actions"><button type="button" className="is-primary" onClick={() => void appUpdater.check(true)}>Try again</button></div>
      </>
    );
  }
  const busy = phase === 'downloading' || phase === 'installing';
  const percent = progress && progress.total ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
  return (
    <>
      <header className="app-update-head">
        <span className="app-update-badge" aria-hidden="true"><FiArrowUpCircle /></span>
        <div>
          <strong>Robo-Boy {release.version} is available</strong>
          <span>You have {update.current}{releasedAgo(release.publishedAt) ? ` · ${releasedAgo(release.publishedAt)}` : ''}</span>
        </div>
        {!busy && <button type="button" className="app-update-icon" aria-label="Remind me later" title="Later" onClick={() => appUpdater.later()}><FiX /></button>}
      </header>

      {phase !== 'installing' && (
        <details className="app-update-details">
          <summary>What's new</summary>
          <ReleaseNotes notes={release.notes} />
        </details>
      )}

      {rosStack && rosStack.length > 0 && (
        <div className="app-update-ros" role="note">
          <FiServer aria-hidden="true" />
          <div>
            <strong>This update also changes the ROS stack</strong>
            <span>Update the ROS host separately afterwards; Robo-Boy reminds you with the command once it restarts.</span>
            <ChangedFiles files={rosStack} />
          </div>
        </div>
      )}

      {phase === 'downloading' && progress && (
        <div className="app-update-progress">
          <progress max={progress.total || 1} value={progress.received} aria-label="Download progress" />
          <span>Downloading {mib(progress.received)} of {mib(progress.total)} · {percent}%</span>
        </div>
      )}
      {phase === 'installing' && <p className="app-update-status" role="status">{installingHint(installer?.name)}</p>}
      {phase === 'failed' && error && <p className="app-update-error" role="alert">{error}</p>}

      <div className="app-update-actions">
        {phase === 'downloading' ? (
          <button type="button" onClick={() => void appUpdater.cancel()}>Cancel</button>
        ) : phase === 'installing' ? null : installer ? (
          <>
            <button type="button" className="is-primary" onClick={() => void appUpdater.install()}>{phase === 'failed' ? 'Try again' : 'Update and restart'}</button>
            {phase === 'failed' && downloaded && <button type="button" onClick={() => void appUpdater.openInstaller()}>Open installer</button>}
            {phase !== 'failed' && <button type="button" onClick={() => appUpdater.later()}>Later</button>}
          </>
        ) : (
          <>
            <button type="button" className="is-primary" onClick={() => void appUpdater.openReleasePage()}>Get it from the release page</button>
            <button type="button" onClick={() => appUpdater.later()}>Later</button>
          </>
        )}
        {!busy && (phase === 'failed'
          ? <button type="button" className="is-link" onClick={() => void appUpdater.openReleasePage()}>Release page</button>
          : <button type="button" className="is-link" onClick={() => appUpdater.skip()}>Skip this version</button>)}
      </div>
    </>
  );
}

function RosReminderCard({ update }: { update: UpdateSnapshot }) {
  const reminder = update.rosReminder!;
  return (
    <>
      <header className="app-update-head">
        <span className="app-update-badge" aria-hidden="true"><FiServer /></span>
        <div>
          <strong>Robo-Boy is now {reminder.to}</strong>
          <span>This version changed the ROS stack. Bring the ROS host up to date so they match.</span>
        </div>
      </header>
      <p className="app-update-muted">Run this in the robo-boy checkout on the ROS host:</p>
      <CopyCommand />
      {reminder.files.length > 0 && <p className="app-update-muted">Changed: <ChangedFiles files={reminder.files} /></p>}
      <div className="app-update-actions">
        <button type="button" className="is-primary" onClick={() => appUpdater.dismissRosReminder(true)}>Done</button>
        <button type="button" onClick={() => appUpdater.dismissRosReminder(false)}>Remind me later</button>
      </div>
    </>
  );
}

/**
 * Desktop updates: a card that offers a new release, carries it through download and install, and,
 * after an update that changed the ROS stack, reminds the person to update the ROS host too.
 */
export default function AppUpdatePrompt() {
  const update = useAppUpdate();
  useEffect(() => { void appUpdater.start(); }, []);
  const showUpdate = update.promptOpen && (Boolean(update.release) || update.phase === 'failed');
  if (!showUpdate && !update.rosReminder) return null;
  return (
    <aside className="app-update" aria-label={showUpdate ? 'Robo-Boy update' : 'ROS stack update'} aria-live="polite">
      {showUpdate ? <UpdateCard update={update} /> : <RosReminderCard update={update} />}
    </aside>
  );
}

/** The switcher menu's line for updates: the running version and what an update is doing. */
export function AppUpdateMenuItem() {
  const update = useAppUpdate();
  if (!update.supported) return null;
  const percent = update.progress?.total ? Math.round((update.progress.received / update.progress.total) * 100) : 0;
  const [status, shown] = update.phase === 'checking' ? ['Checking for updates', 'Checking…']
    : update.phase === 'downloading' ? [`Downloading ${update.release?.version}, ${percent}%`, `Downloading ${percent}%`]
      : update.phase === 'installing' ? ['Installing the update', 'Installing…']
        : update.release ? [`${update.release.version} available`, `${update.release.version} available`]
          : update.phase === 'current' ? ['Up to date', `${update.current} · up to date`]
            : ['Check for updates', `${update.current} · check for updates`];
  return (
    <button type="button" className={`connection-switcher-tool app-update-tool ${update.release ? 'has-update' : ''}`} onClick={() => appUpdater.open()}
      aria-label={`Robo-Boy ${update.current}, ${status}`} disabled={update.phase === 'checking'}>
      <span>Robo-Boy</span>
      <span>{shown}</span>
    </button>
  );
}
