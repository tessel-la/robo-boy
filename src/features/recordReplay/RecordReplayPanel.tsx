import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FiArrowLeft, FiCircle, FiFile, FiFolder, FiPause, FiPlay, FiRepeat, FiRotateCcw, FiRotateCw, FiScissors, FiSquare, FiUpload, FiX } from 'react-icons/fi';
import type { Ros } from 'roslib';
import type { RoboBoyJsonObject } from '../../panels/types';
import type { ReplaySession } from './ReplaySession';
import { defaultRecordOptions, type RecordOptions } from './types';
import { useRecorder } from './useRecorder';
import './RecordReplayPanel.css';

export const formatDuration = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 3600) ? `${Math.floor(total / 3600)}:` : ''}${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GiB` : `${(value / 1024 ** 2).toFixed(1)} MiB`;
function restoreOptions(state?: RoboBoyJsonObject): RecordOptions {
  const defaults = defaultRecordOptions();
  if (state?.version !== 1 || !state.options || typeof state.options !== 'object' || Array.isArray(state.options)) return defaults;
  const candidate = state.options;
  for (const key of Object.keys(defaults) as (keyof RecordOptions)[]) {
    const value = candidate[key];
    if (typeof value === typeof defaults[key] && (typeof value !== 'number' || Number.isFinite(value))) {
      if (key === 'topics') { if (Array.isArray(value)) defaults.topics = value.filter((v): v is string => typeof v === 'string'); }
      else Object.assign(defaults, { [key]: value });
    }
  }
  if (!['none', 'zstd'].includes(defaults.compression)) defaults.compression = 'zstd';
  if (!['auto', 'reliable', 'best_effort'].includes(defaults.qos)) defaults.qos = 'auto';
  return defaults;
}

interface Props {
  session: ReplaySession;
  ros: Ros | null;
  connected: boolean;
  isActive: boolean;
  state?: RoboBoyJsonObject;
  onStateChange: (state: RoboBoyJsonObject) => void;
}
export default function RecordReplayPanel({ session, ros, connected, isActive, state, onStateChange }: Props) {
  const replay = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const recorder = useRecorder(ros, connected && isActive);
  const [tab, setTab] = useState<'replay' | 'record'>('replay');
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const [options, setOptions] = useState(() => restoreOptions(state));
  const [topics, setTopics] = useState<string[]>([]);
  const [topicSearch, setTopicSearch] = useState('');
  const [browse, setBrowse] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const seekTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastSaved = useRef(state?.options);
  useEffect(() => {
    if (state?.options && state.options !== lastSaved.current) { setOptions(restoreOptions(state)); lastSaved.current = state.options; }
  }, [state]);
  useEffect(() => () => clearTimeout(seekTimer.current), []);
  useEffect(() => {
    if (!ros || !connected || !isActive || tab !== 'record') return;
    let disposed = false;
    const refresh = () => ros.getTopics(result => { if (!disposed) setTopics([...new Set(result.topics)].filter(t => !t.startsWith('/roboboy/recorder/')).sort()); });
    refresh(); const timer = setInterval(refresh, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [ros, connected, isActive, tab]);
  const change = (patch: Partial<RecordOptions>) => {
    const next = { ...options, ...patch }; setOptions(next);
    const values = next as unknown as RoboBoyJsonObject;
    lastSaved.current = values; onStateChange({ version: 1, options: values });
  };
  const load = (file?: File) => { if (file) { setTab('replay'); setScrub(null); clearTimeout(seekTimer.current); session.open(file); } };
  const seek = (position: number) => {
    setScrub(position); clearTimeout(seekTimer.current);
    seekTimer.current = setTimeout(() => { session.seek(position); setScrub(null); }, 90);
  };
  const recording = recorder.status?.state === 'recording' || recorder.status?.state === 'paused';
  const busy = recording || recorder.status?.state === 'stopping';
  const ready = Boolean(replay.info) && replay.phase !== 'error';
  const loading = replay.phase === 'loading' || replay.phase === 'seeking';
  const position = scrub ?? replay.position;
  const folderPath = recorder.folders?.directory === '.' ? '' : recorder.folders?.directory ?? '';

  return <section className={`record-replay-panel${dragging ? ' is-dragging' : ''}`} aria-label="Record & Replay"
    onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setDragging(false); load(event.dataTransfer.files[0]); }}>
    <header className="rr-header">
      <div className="rr-tabs" role="group" aria-label="Recording mode">
        <button aria-pressed={tab === 'replay'} onClick={() => setTab('replay')}><FiPlay /> Replay</button>
        <button aria-pressed={tab === 'record'} onClick={() => setTab('record')}><FiCircle className={recording ? 'rr-record-dot' : ''} /> Record</button>
      </div>
      <span className="rr-location">{tab === 'replay' ? 'On this device' : 'On ROS host'}</span>
    </header>
    <input ref={input} type="file" accept=".mcap" aria-label="Open MCAP recording" className="rr-file-input" onChange={event => { load(event.target.files?.[0]); event.target.value = ''; }} />
    {tab === 'replay' ? <div className="rr-body">
      {!replay.info ? <button className={`rr-dropzone${loading ? ' is-loading' : ''}`} onClick={() => input.current?.click()}>
        <span className="rr-bag"><FiFile /><i /><i /><i /></span>
        <strong>{loading ? 'Unpacking your recording…' : 'Drop an MCAP here'}</strong>
        <span>{loading ? 'Reading the index. Your file stays on this device.' : 'or click to choose a recording'}</span>
      </button> : <>
        <div className="rr-file-card">
          <FiFile className={loading ? 'rr-loading-icon' : ''} />
          <div><strong title={replay.info.name}>{replay.info.name}</strong><span>{bytes(replay.info.size)} · {replay.info.topics.length} topics · Local replay</span></div>
          <button aria-label="Replace recording" title="Replace recording" onClick={() => input.current?.click()}><FiUpload /></button>
          <button aria-label="Close recording and return to live data" title="Return to live data" onClick={() => session.close()}><FiX /></button>
        </div>
        <div className="rr-timeline" aria-busy={loading}>
          <div className="rr-time"><output aria-label="Playback position">{formatDuration(position)}</output><span>{loading ? 'Seeking…' : replay.playing ? 'Playing' : 'Paused'}</span><span>{formatDuration(session.duration)}</span></div>
          <input type="range" aria-label="Playback position" min="0" max={session.duration || 1} step="0.001" value={position} disabled={!ready || !session.duration} onChange={event => seek(Number(event.target.value))} />
          <div className="rr-transport">
            <button title="Back 10 seconds" aria-label="Back 10 seconds" disabled={!ready} onClick={() => session.seek(replay.position - 10)}><FiRotateCcw /><small>10</small></button>
            <button className="rr-play" title={replay.playing ? 'Pause' : 'Play'} aria-label={replay.playing ? 'Pause playback' : 'Play recording'} disabled={!ready} onClick={() => replay.playing ? session.pause() : session.play()}>{replay.playing ? <FiPause /> : <FiPlay />}</button>
            <button title="Forward 10 seconds" aria-label="Forward 10 seconds" disabled={!ready} onClick={() => session.seek(replay.position + 10)}><FiRotateCw /><small>10</small></button>
            <select aria-label="Playback speed" value={replay.speed} onChange={event => session.setSpeed(Number(event.target.value))}>{[0.25, 0.5, 1, 2, 4, 8].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select>
            <button aria-label="Loop recording" aria-pressed={replay.loop} title="Loop recording" onClick={() => session.setLoop(!replay.loop)}><FiRepeat /></button>
          </div>
        </div>
        <p className="rr-hint">Time Series, TF and 3D follow this recording. Robot controls stay connected to the live robot.</p>
        <details className="rr-details"><summary>Topics in this recording <span>{replay.info.topics.length}</span></summary>
          <ul className="rr-topic-list">{replay.info.topics.map(topic => <li key={topic.name}><div><strong>{topic.name}</strong><span>{topic.type}</span>{topic.error && <span className="rr-error">{topic.error}</span>}</div><span>{topic.count.toLocaleString()}</span></li>)}</ul>
        </details>
      </>}
      {replay.error && <p className="rr-error" role="alert">{replay.error}</p>}
      {replay.phase === 'error' && <button onClick={() => input.current?.click()}>Choose another MCAP</button>}
    </div> : <div className="rr-body">
      <div className="rr-recorder-status" role="status"><i data-online={recorder.online} /><strong>{!connected ? 'Connect to ROS to record' : !recorder.online ? 'Waiting for the ROS recorder…' : busy ? `Recording ${recorder.status?.state === 'paused' ? 'paused' : recorder.status?.state === 'stopping' ? 'is finishing…' : 'in progress'}` : 'Ready to record'}</strong></div>
      {!recorder.online && <p className="rr-hint">The ROS host needs the Robo-Boy recording service. Recordings are written there, and continue if you close this panel.</p>}
      {recorder.status?.path && <div className="rr-record-summary"><strong>{recorder.status.path}</strong><span>{formatDuration(recorder.status.elapsed)} · {recorder.status.messages.toLocaleString()} messages · {bytes(recorder.status.bytes)} payload</span>{recorder.status.dropped > 0 && <span className="rr-error">{recorder.status.dropped.toLocaleString()} messages dropped: writer queue full.</span>}</div>}
      <form onSubmit={event => { event.preventDefault(); recorder.command('start', options); }}>
        <fieldset disabled={busy || recorder.pending}>
          <label>Destination on ROS host<div className="rr-inline"><input value={options.path} placeholder={recorder.status?.root ?? '/recordings'} onChange={event => change({ path: event.target.value })} /><button type="button" disabled={!recorder.online} onClick={() => { setBrowse(!browse); recorder.command('folders', undefined, options.path); }} aria-label="Browse recording folders"><FiFolder /></button></div></label>
          {browse && recorder.folders && <div className="rr-folder-browser"><strong>{recorder.status?.root}/{folderPath}</strong><button type="button" onClick={() => recorder.command('folders', undefined, folderPath.split('/').slice(0, -1).join('/'))}><FiArrowLeft /> Parent folder</button>{recorder.folders.folders.map(folder => <button type="button" key={folder} onClick={() => recorder.command('folders', undefined, [folderPath, folder].filter(Boolean).join('/'))}><FiFolder />{folder}</button>)}<button type="button" onClick={() => { change({ path: folderPath }); setBrowse(false); }}>Use this folder</button></div>}
          <label>Recording name<input required pattern="[A-Za-z0-9][A-Za-z0-9_.\-]*" maxLength={128} value={options.name} onChange={event => change({ name: event.target.value })} /></label>
          <label className="rr-check"><input type="checkbox" checked={options.allTopics} onChange={event => change({ allTopics: event.target.checked })} />All topics, including newly discovered topics</label>
          {!options.allTopics && <div className="rr-topic-picker"><input aria-label="Filter recording topics" placeholder="Find a topic…" value={topicSearch} onChange={event => setTopicSearch(event.target.value)} /><div>{[...new Set([...topics, ...options.topics])].filter(topic => topic.includes(topicSearch)).sort().map(topic => <label className="rr-check" key={topic}><input type="checkbox" checked={options.topics.includes(topic)} onChange={event => change({ topics: event.target.checked ? [...options.topics, topic] : options.topics.filter(t => t !== topic) })} />{topic}</label>)}</div></div>}
          <div className="rr-grid"><label>Maximum Hz per topic<input type="number" min={0} max={100000} step="any" value={options.frequency} onChange={event => change({ frequency: Number(event.target.value) })} /><small>0 = original publishing rate</small></label><label>Compression<select value={options.compression} onChange={event => change({ compression: event.target.value as RecordOptions['compression'] })}><option value="zstd">Zstandard · fast</option><option value="none">None</option></select></label></div>
          <details className="rr-details"><summary>Advanced recording options</summary>
            <label>Also include topics matching<input placeholder="e.g. ^/robot/" value={options.include} onChange={event => change({ include: event.target.value })} /><small>Regular expression; adds to selected topics.</small></label>
            <label>Exclude topics matching<input placeholder="e.g. /camera/" value={options.exclude} onChange={event => change({ exclude: event.target.value })} /></label>
            <div className="rr-grid"><label>Split size (MiB)<input type="number" min={0} step={1} value={options.maxSizeMiB} onChange={event => change({ maxSizeMiB: Number(event.target.value) })} /></label><label>Split interval (seconds)<input type="number" min={0} step={1} value={options.maxDurationSec} onChange={event => change({ maxDurationSec: Number(event.target.value) })} /></label></div><p className="rr-hint">0 disables automatic splitting.</p>
            <div className="rr-grid"><label>Writer queue (MiB)<input type="number" min={1} max={1024} value={options.cacheMiB} onChange={event => change({ cacheMiB: Number(event.target.value) })} /></label><label>Delivery policy (QoS)<select value={options.qos} onChange={event => change({ qos: event.target.value as RecordOptions['qos'] })}><option value="auto">Match publishers</option><option value="reliable">Reliable</option><option value="best_effort">Best effort</option></select></label></div>
            <label className="rr-check"><input type="checkbox" checked={options.includeHidden} onChange={event => change({ includeHidden: event.target.checked })} />Include hidden topics</label>
            <label className="rr-check"><input type="checkbox" checked={options.useSimTime} onChange={event => change({ useSimTime: event.target.checked })} />Use simulation time from /clock</label>
          </details>
        </fieldset>
        <div className="rr-record-actions">{!busy ? <button className="rr-start" type="submit" disabled={!recorder.online || recorder.pending}><FiCircle />Start recording</button> : <>
          <button type="button" disabled={!recorder.online || recorder.pending || !recording} onClick={() => recorder.command(recorder.status?.state === 'paused' ? 'resume' : 'pause')}>{recorder.status?.state === 'paused' ? <FiPlay /> : <FiPause />}{recorder.status?.state === 'paused' ? 'Resume' : 'Pause'}</button>
          <button type="button" disabled={!recorder.online || recorder.pending || !recording} onClick={() => recorder.command('split')}><FiScissors />Split</button>
          <button type="button" className="rr-start" disabled={!recorder.online || recorder.pending || !recording} onClick={() => recorder.command('stop')}><FiSquare />Stop & save</button>
        </>}</div>
      </form>
      {(recorder.error || recorder.status?.error) && <p className="rr-error" role="alert">{recorder.error || recorder.status?.error}</p>}
    </div>}
    {dragging && <div className="rr-drop-overlay"><FiUpload /><strong>Drop to replay</strong></div>}
  </section>;
}
