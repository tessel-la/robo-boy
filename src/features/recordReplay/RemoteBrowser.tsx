import { Fragment } from 'react';
import { FiChevronRight, FiDisc, FiDownload, FiFile, FiFolder, FiPlay, FiRefreshCw, FiServer, FiX } from 'react-icons/fi';
import type { DownloadSnapshot } from './downloadRecording';
import { formatBytes, formatDuration } from './format';
import type { RemoteRecording, RemoteRecordingFile, RemoteRecordingsState } from './remoteRecordings';

interface BrowserProps {
  state: RemoteRecordingsState;
  path: string;
  /** A download is running; only one at a time. */
  downloading: boolean;
  onBrowse: (path: string) => void;
  onRefresh: () => void;
  onReplay: (file: RemoteRecordingFile) => void;
  onDownload: (file: RemoteRecordingFile) => void;
}

const describeBag = (bag: RemoteRecording) => bag.active ? 'Being recorded · available when it stops' : [
  bag.duration !== undefined && formatDuration(bag.duration),
  bag.messages !== undefined && `${bag.messages.toLocaleString()} messages`,
  formatBytes(bag.files.reduce((total, file) => total + file.size, 0)),
  bag.files.length > 1 && `${bag.files.length} parts`,
  !bag.files.length && 'no MCAP files',
].filter(Boolean).join(' · ');

/** The recording root on the ROS host: folders, bags and MCAP files, each replayable in place or downloadable. */
export function RemoteBrowser({ state, path, downloading, onBrowse, onRefresh, onReplay, onDownload }: BrowserProps) {
  if (state.status === 'idle') return null;
  const listing = state.listing;
  const loading = state.status === 'loading';
  const parts = path ? path.split('/') : [];
  const empty = listing && !listing.folders.length && !listing.recordings.length && !listing.files.length;
  const actions = (file: RemoteRecordingFile) => <span className="rr-remote-actions">
    <button className="rr-icon" aria-label={`Replay ${file.name} from the ROS host`} title="Replay from the ROS host" onClick={() => onReplay(file)}><FiPlay /></button>
    <button className="rr-icon" aria-label={`Download ${file.name}`} title={downloading ? 'Another download is running' : 'Download to this device'} disabled={downloading} onClick={() => onDownload(file)}><FiDownload /></button>
  </span>;
  return <section className="rr-remote" aria-label="Recordings on the ROS host" aria-busy={loading}>
    <header className="rr-remote-head">
      <strong><FiServer /> On the ROS host</strong>
      <button className="rr-icon" aria-label="Refresh recordings on the ROS host" title="Refresh" disabled={loading} onClick={onRefresh}><FiRefreshCw className={loading ? 'rr-spin' : ''} /></button>
    </header>
    <nav className="rr-crumbs" aria-label="Recording folder">
      <button aria-current={parts.length ? undefined : 'location'} onClick={() => onBrowse('')}>recordings</button>
      {parts.map((part, index) => <Fragment key={parts.slice(0, index + 1).join('/')}>
        <FiChevronRight aria-hidden="true" />
        <button aria-current={index === parts.length - 1 ? 'location' : undefined} onClick={() => onBrowse(parts.slice(0, index + 1).join('/'))}>{part}</button>
      </Fragment>)}
    </nav>
    {state.status === 'error' && <div className="rr-remote-error"><p className="rr-error" role="alert">{state.error}</p><button onClick={onRefresh}><FiRefreshCw /> Try again</button></div>}
    {!listing && loading && <p className="rr-hint">Looking for recordings…</p>}
    {empty && state.status !== 'error' && <p className="rr-hint">No recordings here yet. Recordings started from the Record tab appear here once they stop.</p>}
    {listing && <ul className="rr-remote-list">
      {listing.folders.map(folder => <li key={`folder:${folder}`}>
        <button className="rr-remote-folder" onClick={() => onBrowse([path, folder].filter(Boolean).join('/'))}><FiFolder /><span>{folder}</span><FiChevronRight /></button>
      </li>)}
      {listing.recordings.map(bag => <li key={`bag:${bag.path}`} className="rr-remote-item">
        <FiDisc className={bag.active ? 'rr-record-dot' : undefined} />
        <div><strong title={bag.name}>{bag.name}</strong><span>{describeBag(bag)}</span></div>
        {!bag.active && bag.files.length === 1 && actions(bag.files[0])}
        {!bag.active && bag.files.length > 1 && <ul className="rr-remote-parts" aria-label={`Parts of ${bag.name}`}>
          {bag.files.map((file, index) => <li key={file.path} className="rr-remote-item">
            <FiFile /><div><strong title={file.name}>{file.name}</strong><span>Part {index + 1} of {bag.files.length} · {formatBytes(file.size)}</span></div>{actions(file)}
          </li>)}
        </ul>}
      </li>)}
      {listing.files.map(file => <li key={`file:${file.path}`} className="rr-remote-item">
        <FiFile /><div><strong title={file.name}>{file.name}</strong><span>{formatBytes(file.size)}</span></div>{actions(file)}
      </li>)}
    </ul>}
  </section>;
}

interface DownloadProps {
  snapshot: DownloadSnapshot;
  canResume: boolean;
  onCancel: () => void;
  onResume: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}

/** Progress of a recording being copied from the ROS host, then a way to replay the copy. */
export function DownloadCard({ snapshot, canResume, onCancel, onResume, onOpen, onDismiss }: DownloadProps) {
  const { name, phase, loaded, total, rate } = snapshot;
  const running = phase === 'downloading' || phase === 'retrying';
  const remaining = rate > 0 ? formatDuration((total - loaded) / rate) : '';
  const detail = phase === 'done' ? `Saved · ${formatBytes(total)}`
    : `${formatBytes(loaded)} of ${formatBytes(total)}${phase === 'downloading' && rate > 0 ? ` · ${formatBytes(rate)}/s · ${remaining} left` : ''}`;
  return <div className={`rr-download is-${phase}`} role="status" aria-label={`Download of ${name}`}>
    <FiDownload />
    <div>
      <strong title={name}>{name}</strong>
      <span>{detail}</span>
      {phase !== 'done' && <progress max={total || 1} value={loaded} aria-label="Download progress" />}
      {snapshot.error && <span className={phase === 'error' ? 'rr-error' : undefined}>{snapshot.error}</span>}
    </div>
    <div className="rr-download-actions">
      {phase === 'done' && <button onClick={onOpen}><FiPlay /> Replay</button>}
      {phase === 'error' && canResume && <button onClick={onResume}><FiRefreshCw /> Resume</button>}
      {running
        ? <button className="rr-icon" aria-label={`Cancel download of ${name}`} title="Cancel and delete the partial file" onClick={onCancel}><FiX /></button>
        : <button className="rr-icon" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}><FiX /></button>}
    </div>
  </div>;
}
