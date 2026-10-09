import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { FiArrowLeft, FiCircle, FiDisc, FiFile, FiFolder, FiPause, FiPlay, FiRefreshCw, FiRepeat, FiRotateCcw, FiRotateCw, FiScissors, FiServer, FiSquare, FiUpload, FiX } from 'react-icons/fi';
import type { Ros } from 'roslib';
import type { RoboBoyJsonObject } from '../../panels/types';
import { useRuntimeConfig } from '../../runtime/runtimeConfig';
import { canSaveToDisk, chooseSaveTarget, downloadWithBrowser, RecordingDownload, type DownloadSnapshot } from './downloadRecording';
import { DownloadCard, RemoteBrowser } from './RemoteBrowser';
import { remoteBag, useRemoteRecordings, type RemoteRecordingFile } from './remoteRecordings';
import type { ReplaySession } from './ReplaySession';
import { defaultRecordOptions, type BagSource, type RecordOptions } from './types';
import { formatBytes as bytes, formatDuration } from './format';
import { useRecorder } from './useRecorder';
import { describeRecordReplay, planRecordReplaySettings, readRecording, RECORD_REPLAY_SETTINGS_HELP, sampleRecording, type RecordingReadResult, type RecordingSample } from './assistantBridge';
import type { PanelSettingsBridge } from '../assistant/types';
import './RecordReplayPanel.css';

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
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
  /** Lets the AI assistant read the recording and recorder, and drive them. */
  panelId?: string;
  onRegisterAssistantBridge?: (panelId: string, bridge: PanelSettingsBridge | null) => void;
}
export default function RecordReplayPanel({ session, ros, connected, isActive, state, onStateChange, panelId, onRegisterAssistantBridge }: Props) {
  const replay = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const recorder = useRecorder(ros, connected && isActive);
  const [tab, setTab] = useState<'replay' | 'record'>(state?.initialTab === 'record' ? 'record' : 'replay');
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const [options, setOptions] = useState(() => restoreOptions(state));
  const [topics, setTopics] = useState<string[]>([]);
  const [topicSearch, setTopicSearch] = useState('');
  const [browse, setBrowse] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!speedOpen) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !speedRef.current?.contains(event.target as Node)) setSpeedOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [speedOpen]);
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
  const load = (source?: BagSource) => { if (source) { setTab('replay'); setScrub(null); clearTimeout(seekTimer.current); session.open(source); } };
  const { recordingsBaseUrl } = useRuntimeConfig();
  const [remotePath, setRemotePath] = useState('');
  const remote = useRemoteRecordings(recordingsBaseUrl, remotePath, connected && isActive && tab === 'replay' && !replay.info);
  const [download, setDownload] = useState<{ job?: RecordingDownload; snapshot?: DownloadSnapshot; browser?: string; error?: string }>();
  const downloading = download?.snapshot?.phase === 'downloading' || download?.snapshot?.phase === 'retrying';
  const startDownload = (file: RemoteRecordingFile) => {
    const bag = remoteBag(recordingsBaseUrl, file);
    if (!canSaveToDisk()) { downloadWithBrowser(bag.url); setDownload({ browser: bag.name }); return; }
    // The save dialog must open from the click itself, before anything is awaited.
    chooseSaveTarget(bag.name).then(handle => {
      if (!handle) return;
      const job = new RecordingDownload(bag, handle, snapshot => setDownload(current => current?.job === job ? { job, snapshot } : current));
      setDownload({ job, snapshot: job.snapshot });
      void job.run();
    }).catch((error: unknown) => setDownload({ error: `This device could not create the file: ${error instanceof Error ? error.message : String(error)}` }));
  };
  const dismissDownload = () => { if (download?.snapshot?.phase !== 'done') void download?.job?.cancel(); setDownload(undefined); };
  const openDownload = () => { download?.job?.file().then(file => { setDownload(undefined); load(file); }, (error: unknown) => setDownload({ error: `The saved file could not be opened: ${String(error)}` })); };
  const seek = (position: number) => {
    setScrub(position); clearTimeout(seekTimer.current);
    seekTimer.current = setTimeout(() => { session.seek(position); setScrub(null); }, 90);
  };
  const recording = recorder.status?.state === 'recording' || recorder.status?.state === 'paused';
  const busy = recording || recorder.status?.state === 'stopping';
  const wasBusy = useRef(busy);
  useEffect(() => {
    // The finished name now exists on the host; offer a fresh one so Start works straight away.
    if (wasBusy.current && !busy && recorder.status?.path.split('/').pop() === options.name) change({ name: defaultRecordOptions().name });
    wasBusy.current = busy;
  });
  // The AI assistant's bridge is registered once and reads the latest state through this ref.
  // Messages it sampled are kept here too, so the next turn sees them before React re-renders.
  const samples = useRef<RecordingSample[]>([]);
  const lastRead = useRef<RecordingReadResult>();
  useEffect(() => { samples.current = []; lastRead.current = undefined; }, [replay.info]);
  const assistantState = useRef({ replay, tab, connected, recorder, options, remote: remote.state, change, load, setTab, setRemotePath, recordingsBaseUrl });
  assistantState.current = { replay, tab, connected, recorder, options, remote: remote.state, change, load, setTab, setRemotePath, recordingsBaseUrl };
  useEffect(() => {
    if (!panelId || !onRegisterAssistantBridge) return;
    const input = () => {
      const current = assistantState.current;
      return {
        replay: current.replay, duration: session.duration, tab: current.tab, connected: current.connected,
        recorder: { online: current.recorder.online, pending: current.recorder.pending, status: current.recorder.status, error: current.recorder.error },
        options: current.options, remote: current.remote, samples: samples.current, lastRead: lastRead.current,
      };
    };
    const bridge: PanelSettingsBridge = {
      panelType: 'recordReplay',
      settingsHelp: RECORD_REPLAY_SETTINGS_HELP,
      describe: () => describeRecordReplay(input()),
      apply: async settings => {
        const current = assistantState.current;
        const { steps, outcomes } = planRecordReplaySettings(settings, input());
        for (const step of steps) {
          if (step.kind === 'tab') current.setTab(step.tab);
          else if (step.kind === 'close') session.close();
          else if (step.kind === 'browse') current.setRemotePath(step.path);
          else if (step.kind === 'open') current.load(remoteBag(current.recordingsBaseUrl, step.file));
          else if (step.kind === 'seek') session.seek(step.seconds);
          else if (step.kind === 'speed') session.setSpeed(step.speed);
          else if (step.kind === 'loop') session.setLoop(step.loop);
          else if (step.kind === 'play') { if (step.playing) session.play(); else session.pause(); }
          else if (step.kind === 'options') current.change(step.patch);
          else if (step.kind === 'recorder') current.recorder.command(step.command, step.options);
          else if (step.kind === 'sample') {
            // Read from the source after any seek above: seeking backwards replaces it.
            const source = session.source.ros;
            if (!source) { outcomes.push({ ok: false, message: 'The recording closed before it could be read.' }); continue; }
            samples.current = await sampleRecording(source, step.topics, session.snapshot.position);
            const empty = samples.current.filter(sample => sample.unavailable).map(sample => sample.topic);
            if (empty.length) outcomes.push({ ok: false, message: `Nothing of ${empty.join(', ')} was recorded before this position.` });
          } else if (step.kind === 'read') {
            const start = session.snapshot.info?.start;
            if (start === undefined) { outcomes.push({ ok: false, message: 'The recording closed before it could be read.' }); continue; }
            const result = await readRecording((from, to, topics, keep) => session.readRange(from, to, topics, keep), step.request, start);
            lastRead.current = result;
            if (result.error) outcomes.push({ ok: false, message: `Reading failed: ${result.error}` });
            else outcomes.push({ ok: true, message: `Found ${result.matched.toLocaleString('en')} matching of ${result.scanned.toLocaleString('en')} messages${result.stoppedBecause ? `; stopped at ${result.stoppedAtSec} s because it ${result.stoppedBecause}` : ''}.` });
          }
        }
        return outcomes;
      },
    };
    onRegisterAssistantBridge(panelId, bridge);
    return () => onRegisterAssistantBridge(panelId, null);
  }, [panelId, onRegisterAssistantBridge, session]);
  const ready = Boolean(replay.info) && replay.phase !== 'error';
  const loading = replay.phase === 'loading' || replay.phase === 'seeking';
  const position = scrub ?? replay.position;
  const folderPath = recorder.folders?.directory === '.' ? '' : recorder.folders?.directory ?? '';
  // Where the last recording landed, relative to the root the file service lists.
  const savedPath = recorder.status?.path && recorder.status.path.startsWith(`${recorder.status.root}/`) ? recorder.status.path.slice(recorder.status.root.length + 1) : undefined;

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
      <span className="rr-location">{tab === 'record' || replay.remote ? 'On ROS host' : 'On this device'}</span>
    </header>
    <input ref={input} type="file" accept=".mcap" aria-label="Open MCAP recording" className="rr-file-input" onChange={event => { load(event.target.files?.[0]); event.target.value = ''; }} />
    {tab === 'replay' ? <div className="rr-body" key="replay">
      {download?.snapshot && <DownloadCard snapshot={download.snapshot} canResume={Boolean(download.job?.canResume)} onCancel={dismissDownload}
        onResume={() => void download.job?.run()} onOpen={openDownload} onDismiss={dismissDownload} />}
      {download?.browser && <p className="rr-download-note" role="status">Your browser is downloading {download.browser}. When it finishes, drop it here to replay it. <button className="rr-icon" aria-label="Dismiss" onClick={() => setDownload(undefined)}><FiX /></button></p>}
      {download?.error && <p className="rr-error" role="alert">{download.error}</p>}
      {!replay.info ? <>
        <button className={`rr-dropzone${loading ? ' is-loading' : ''}${remote.state.status !== 'idle' ? ' is-compact' : ''}`} onClick={() => input.current?.click()}>
          <span className="rr-bag">{replay.remote ? <FiServer /> : <FiFile />}<i /><i /><i /></span>
          <strong>{loading ? 'Unpacking your recording…' : 'Drop an MCAP here'}</strong>
          <span>{loading ? replay.remote ? 'Reading its index on the ROS host. Only the parts you play are transferred.' : 'Reading the index. Your file stays on this device.' : 'or click to choose a recording'}</span>
        </button>
        {!loading && <RemoteBrowser state={remote.state} path={remotePath} downloading={downloading} onBrowse={setRemotePath} onRefresh={remote.refresh}
          onReplay={file => load(remoteBag(recordingsBaseUrl, file))} onDownload={startDownload} />}
      </> : <>
        <div className="rr-file-card">
          {replay.remote ? <FiServer className={loading ? 'rr-loading-icon' : ''} /> : <FiFile className={loading ? 'rr-loading-icon' : ''} />}
          <div><strong title={replay.info.name}>{replay.info.name}</strong><span>{bytes(replay.info.size)} · {replay.info.topics.length} topics · {replay.remote ? 'Replaying from the ROS host' : 'Local replay'}</span></div>
          <button aria-label="Replace recording" title="Replace recording" onClick={() => input.current?.click()}><FiUpload /></button>
          <button aria-label="Close recording and return to live data" title="Return to live data" onClick={() => session.close()}><FiX /></button>
        </div>
        <div className="rr-timeline" aria-busy={loading}>
          <div className="rr-time"><output aria-label="Playback position">{formatDuration(position)}</output><span>{loading ? 'Seeking…' : !replay.playing ? 'Paused' : replay.buffering ? 'Buffering…' : 'Playing'}</span><span>{formatDuration(session.duration)}</span></div>
          <input type="range" aria-label="Playback position" min="0" max={session.duration || 1} step="0.001" value={position}
            style={{ '--progress': `${session.duration ? (position / session.duration) * 100 : 0}%` } as CSSProperties} disabled={!ready || !session.duration} onChange={event => seek(Number(event.target.value))} />
          <div className="rr-transport">
            <button className="rr-round" aria-label="Loop recording" aria-pressed={replay.loop} title="Loop recording" onClick={() => session.setLoop(!replay.loop)}><FiRepeat /></button>
            <div className="rr-core">
              <button className="rr-skip rr-skip-back" title="Back 10 seconds" aria-label="Back 10 seconds" disabled={!ready} onClick={() => session.seek(replay.position - 10)}><FiRotateCcw /><span aria-hidden="true">10s</span></button>
              <button className={`rr-play${replay.playing ? ' is-playing' : ''}`} title={replay.playing ? 'Pause' : 'Play'} aria-label={replay.playing ? 'Pause playback' : 'Play recording'} disabled={!ready} onClick={() => replay.playing ? session.pause() : session.play()}>{replay.playing ? <FiPause key="pause" /> : <FiPlay key="play" className="rr-play-icon" />}</button>
              <button className="rr-skip rr-skip-forward" title="Forward 10 seconds" aria-label="Forward 10 seconds" disabled={!ready} onClick={() => session.seek(replay.position + 10)}><span aria-hidden="true">10s</span><FiRotateCw /></button>
            </div>
            <div className="rr-speed" ref={speedRef}>
              <button className="rr-round rr-speed-toggle" aria-label={`Playback speed ${replay.speed}×`} aria-haspopup="true" aria-expanded={speedOpen} title="Playback speed" onClick={() => setSpeedOpen(open => !open)}>{replay.speed}×</button>
              {speedOpen && <div className="rr-speed-menu" role="group" aria-label="Playback speed">
                {SPEEDS.map(speed => <button key={speed} aria-pressed={replay.speed === speed} onClick={() => { session.setSpeed(speed); setSpeedOpen(false); }}>{speed}×</button>)}
              </div>}
            </div>
          </div>
        </div>
        <p className="rr-hint">Camera, Time Series, TF and 3D follow this recording. Robot controls stay connected to the live robot.</p>
        <details className="rr-details"><summary>Topics in this recording <span>{replay.info.topics.length}</span></summary>
          <ul className="rr-topic-list">{replay.info.topics.map(topic => <li key={topic.name}><div><strong>{topic.name}</strong><span>{topic.type}</span>{topic.error && <span className="rr-error">{topic.error}</span>}</div><span>{topic.count.toLocaleString()}</span></li>)}</ul>
        </details>
      </>}
      {replay.error && <p className="rr-error" role="alert">{replay.error}</p>}
      {replay.phase === 'error' && <div className="rr-error-actions">
        {session.canRetry && <button onClick={() => session.retry()}><FiRefreshCw /> {replay.info ? 'Reconnect and continue' : 'Try again'}</button>}
        <button onClick={() => input.current?.click()}>Choose another MCAP</button>
      </div>}
    </div> : <div className="rr-body" key="record">
      <div className="rr-recorder-status" role="status"><i data-online={recorder.online} data-recording={recorder.status?.state === 'recording'} /><strong>{!connected ? 'Connect to ROS to record' : !recorder.online ? 'Waiting for the ROS recorder…' : busy ? `Recording ${recorder.status?.state === 'paused' ? 'paused' : recorder.status?.state === 'stopping' ? 'is finishing…' : 'in progress'}` : 'Ready to record'}</strong></div>
      {connected && !recorder.online && <p className="rr-hint">The ROS host needs the Robo-Boy recording service. Recordings are written there, and continue if you close this panel.</p>}
      {recorder.status?.path && <div className="rr-record-summary"><strong>{recorder.status.path}</strong><span>{formatDuration(recorder.status.elapsed)} · {recorder.status.messages.toLocaleString()} messages · {bytes(recorder.status.bytes)} payload</span>{recorder.status.dropped > 0 && <span className="rr-error">{recorder.status.dropped.toLocaleString()} messages dropped: writer queue full.</span>}
        {!busy && savedPath && !replay.info && <button type="button" onClick={() => { setRemotePath(savedPath); setTab('replay'); }}><FiPlay /> Find it in Replay</button>}</div>}
      <form onSubmit={event => { event.preventDefault(); recorder.command('start', options); }}>
        <fieldset disabled={busy || recorder.pending}>
          <label>Destination on ROS host<div className="rr-inline"><input value={options.path} placeholder={recorder.status?.root ?? '/recordings'} onChange={event => change({ path: event.target.value })} /><button type="button" disabled={!recorder.online} onClick={() => { setBrowse(!browse); recorder.command('folders', undefined, options.path); }} aria-label="Browse recording folders"><FiFolder /></button></div></label>
          {browse && recorder.folders && <div className="rr-folder-browser"><strong>{recorder.status?.root}/{folderPath}</strong><button type="button" disabled={!folderPath} onClick={() => recorder.command('folders', undefined, folderPath.split('/').slice(0, -1).join('/'))}><FiArrowLeft /> Parent folder</button>{recorder.folders.folders.map(folder => <button type="button" key={folder} onClick={() => recorder.command('folders', undefined, [folderPath, folder].filter(Boolean).join('/'))}><FiFolder />{folder}</button>)}{recorder.folders.recordings.map(name => <span className="rr-folder-recording" key={name} title="Existing recording"><FiDisc />{name}</span>)}<button type="button" onClick={() => { change({ path: folderPath }); setBrowse(false); }}>Use this folder</button></div>}
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
