import type { AssistantCapability } from '../assistant/capabilities';
import ROSLIB, { type Ros } from 'roslib';
import { boundedPreview } from '../dataExplorer/model';
import type { RemoteRecordingFile, RemoteRecordingsState } from './remoteRecordings';
import type { ReplaySnapshot } from './ReplaySession';
import { defaultRecordOptions, type RecorderStatus, type RecordOptions } from './types';

/*
 * Record & Replay as the AI assistant sees it. `describeRecordReplay` summarises the open recording
 * (its topics, counts, rates and definitions, the playback cursor, messages sampled from it) and the
 * recorder on the ROS host; `planRecordReplaySettings` validates the assistant's request into steps
 * the panel carries out. Opening a file from this device stays with the user: only they can pick it.
 */

export const RECORD_REPLAY_SETTINGS_HELP = [
  'Record & Replay plays MCAP recordings (Camera, Time Series, TF, 3D and the Data Explorer follow it) and drives the recorder on the ROS host. Its settings report the open recording (name, duration, every topic with type, message count, average rate and a short definition), the playback cursor, messages sampled from it, recordings stored on the ROS host, and the recorder\'s state and options.',
  'It accepts: "openRecording":"<path of a recording file or single-file recording on the ROS host>" (a file on this device must be chosen by the user); "browse":"<folder on the ROS host>"; "closeRecording":true;',
  '"play":true|false; "seek":<seconds from the start>; "speed":0.25|0.5|1|2|4|8; "loop":true|false;',
  '"sample":["/topic",...] (up to 6) reads the latest message of each topic at the cursor (after "seek" when both are given); the messages appear in "samples" on the next turn, so ask about them in "followUp";',
  '"read":{"topics":["/rosout"],"fromSec":0,"toSec":120,"limit":100,"everySec":1,"fields":["percentage"],"match":"error"} reads every message of up to 6 topics over a stretch of the recording without moving playback: "everySec" keeps at most one message per topic per interval, "fields" keeps only those dot/index paths, "match" keeps only messages whose text contains it (case-insensitive), "limit" (at most 300) caps what is returned while matches are still counted; the result appears in "lastRead" on the next turn, so ask about it in "followUp";',
  '"tab":"replay"|"record"; "recordOptions":{"name":"run_1","path":"folder","allTopics":false,"topics":["/a"],"include":"regex","exclude":"regex","frequency":0,"compression":"zstd"|"none","maxSizeMiB":0,"maxDurationSec":0,"qos":"auto"|"reliable"|"best_effort","includeHidden":false,"useSimTime":false};',
  '"recorder":"start"|"stop"|"pause"|"resume"|"split" controls a recording on the ROS host with the panel\'s options; start only when the user asks to record.',
].join(' ');

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const SAMPLE_LIMIT = 6;
const READ_LIMIT = 300;
/** What one read may put in the prompt, and how long it may take. */
const READ_CHARS = 60000;
const READ_SECONDS = 20;
const SCAN_LIMIT = 500000;

export interface RecordingReadRequest {
  topics: string[];
  fromSec: number;
  toSec: number;
  limit: number;
  everySec?: number;
  fields?: string[];
  match?: string;
}

export interface RecordingReadResult extends RecordingReadRequest {
  /** Messages of the chosen topics the reader went through, and how many passed "match". */
  scanned: number;
  matched: number;
  /** Seconds into the recording where reading stopped, when it did not reach "toSec". */
  stoppedAtSec?: number;
  stoppedBecause?: string;
  messages: { topic: string; atSec: number; value: unknown }[];
  error?: string;
}
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

export interface RecordingSample {
  topic: string;
  type: string;
  /** Playback position the message was read at, in seconds from the start. */
  atSeconds: number;
  value?: unknown;
  shortened?: boolean;
  unavailable?: string;
}

export interface RecordReplayBridgeInput {
  replay: ReplaySnapshot;
  duration: number;
  tab: 'replay' | 'record';
  connected: boolean;
  recorder: { online: boolean; pending: boolean; status?: RecorderStatus; error: string };
  options: RecordOptions;
  remote: RemoteRecordingsState;
  samples: RecordingSample[];
  lastRead?: RecordingReadResult;
}

const listing = (remote: RemoteRecordingsState) => ('listing' in remote ? remote.listing : undefined);

export function describeRecordReplay(input: RecordReplayBridgeInput) {
  const { replay, duration, recorder, options, remote } = input;
  const info = replay.info;
  const files = listing(remote);
  const recording = recorder.status?.state === 'recording' || recorder.status?.state === 'paused';
  return {
    tab: input.tab,
    replay: info
      ? {
          name: info.name,
          from: replay.remote ? 'ROS host (read in place)' : 'this device',
          sizeBytes: info.size,
          durationSec: round(duration),
          startTime: new Date(Number(info.start / 1000000n)).toISOString(),
          state: replay.phase === 'error' ? 'error' : replay.phase === 'seeking' || replay.phase === 'loading' ? 'seeking' : replay.playing ? (replay.buffering ? 'buffering' : 'playing') : 'paused',
          positionSec: round(replay.position),
          speed: replay.speed,
          loop: replay.loop,
          error: replay.error,
          topics: info.topics.map(topic => ({
            name: topic.name,
            type: topic.type,
            messages: topic.count,
            averageHz: duration > 0 ? round(topic.count / duration) : undefined,
            unreadable: topic.error,
            definition: topic.definition ? topic.definition.slice(0, 300) + (topic.definition.length > 300 ? '…' : '') : undefined,
          })),
          followedBy: 'Camera, Time Series, TF, 3D and the Data Explorer show this recording; robot controls stay on the live robot.',
        }
      : { state: replay.phase === 'loading' ? 'opening a recording' : replay.phase === 'error' ? 'error' : 'no recording open', error: replay.error },
    samples: input.samples.length
      ? input.samples.map(sample => ({ ...sample, atSeconds: round(sample.atSeconds) }))
      : undefined,
    lastRead: input.lastRead,
    recordingsOnRosHost:
      remote.status === 'idle'
        ? info
          ? undefined
          : 'Listed while the Replay tab shows no open recording and ROS is connected.'
        : {
            folder: files?.directory || '/',
            status: remote.status,
            error: remote.status === 'error' ? remote.error : undefined,
            folders: files?.folders,
            recordings: files?.recordings.slice(0, 50).map(item => ({
              name: item.name,
              path: item.path,
              stillRecording: item.active || undefined,
              durationSec: item.duration,
              messages: item.messages,
              files: item.files.map(file => ({ path: file.path, sizeBytes: file.size })),
            })),
            files: files?.files.slice(0, 50).map(file => ({ path: file.path, sizeBytes: file.size })),
          },
    recorder: {
      available: input.connected ? recorder.online : 'not connected to ROS',
      state: recorder.status?.state,
      busy: recorder.pending || undefined,
      file: recorder.status?.path || undefined,
      elapsedSec: recording ? round(recorder.status?.elapsed ?? 0, 1) : undefined,
      messages: recording ? recorder.status?.messages : undefined,
      bytes: recording ? recorder.status?.bytes : undefined,
      dropped: recorder.status?.dropped || undefined,
      recordingTopics: recording ? recorder.status?.topics.slice(0, 100) : undefined,
      error: recorder.error || recorder.status?.error || undefined,
      options,
    },
  };
}

export type RecordReplayStep =
  | { kind: 'tab'; tab: 'replay' | 'record' }
  | { kind: 'close' }
  | { kind: 'open'; file: RemoteRecordingFile }
  | { kind: 'browse'; path: string }
  | { kind: 'seek'; seconds: number }
  | { kind: 'speed'; speed: number }
  | { kind: 'loop'; loop: boolean }
  | { kind: 'play'; playing: boolean }
  | { kind: 'sample'; topics: { name: string; type: string }[] }
  | { kind: 'read'; request: RecordingReadRequest }
  | { kind: 'options'; patch: Partial<RecordOptions> }
  | { kind: 'recorder'; command: 'start' | 'stop' | 'pause' | 'resume' | 'split'; options?: RecordOptions };

const KNOWN_KEYS = new Set(['openRecording', 'browse', 'closeRecording', 'play', 'seek', 'speed', 'loop', 'sample', 'read', 'tab', 'recordOptions', 'recorder']);

/** Validates the assistant's request into ordered steps; everything refused says why. */
export function planRecordReplaySettings(settings: Record<string, unknown>, input: RecordReplayBridgeInput) {
  const steps: RecordReplayStep[] = [];
  const outcomes: Array<{ ok: boolean; message: string }> = [];
  const { replay, duration, recorder } = input;
  let open = Boolean(replay.info);

  if (settings.tab === 'replay' || settings.tab === 'record') {
    steps.push({ kind: 'tab', tab: settings.tab });
    outcomes.push({ ok: true, message: `Showing the ${settings.tab === 'replay' ? 'Replay' : 'Record'} tab.` });
  }

  if (settings.closeRecording === true) {
    if (open) {
      steps.push({ kind: 'close' });
      open = false;
      outcomes.push({ ok: true, message: 'Closed the recording; panels show live data again.' });
    } else outcomes.push({ ok: false, message: 'No recording is open.' });
  }

  if (typeof settings.browse === 'string') {
    steps.push({ kind: 'tab', tab: 'replay' }, { kind: 'browse', path: settings.browse.replace(/^\/+|\/+$/g, '') });
    outcomes.push({ ok: true, message: `Listing recordings in ${settings.browse || 'the recording root'} on the ROS host.` });
  }

  if (typeof settings.openRecording === 'string') {
    const wanted = settings.openRecording.replace(/^\/+/, '');
    const files = listing(input.remote);
    const recordingMatch = files?.recordings.find(item => item.path === wanted || item.name === wanted);
    const file =
      files?.files.find(item => item.path === wanted || item.name === wanted) ??
      files?.recordings.flatMap(item => item.files).find(item => item.path === wanted || item.name === wanted) ??
      (recordingMatch?.files.length === 1 ? recordingMatch.files[0] : undefined);
    if (recordingMatch?.active) outcomes.push({ ok: false, message: `${recordingMatch.name} is still being recorded; open it once the recording stops.` });
    else if (file) {
      steps.push({ kind: 'tab', tab: 'replay' }, { kind: 'open', file });
      open = true;
      outcomes.push({ ok: true, message: `Opening ${file.name} from the ROS host.` });
    } else if (recordingMatch && recordingMatch.files.length > 1)
      outcomes.push({ ok: false, message: `${recordingMatch.name} is split into ${recordingMatch.files.length} files; name one: ${recordingMatch.files.map(item => item.path).join(', ')}.` });
    else
      outcomes.push({
        ok: false,
        message: files
          ? `No recording named ${wanted} in the listed folder. A file on this device has to be dropped on the panel or chosen by the user.`
          : 'The ROS host\'s recordings are not listed yet: close the open recording or browse a folder first. A file on this device has to be chosen by the user.',
      });
  }

  const openedNow = steps.some(step => step.kind === 'open');
  const needsOpen = (what: string) => {
    if (open && !openedNow) return true;
    outcomes.push({ ok: false, message: openedNow ? `The recording is still opening; ask again to ${what}.` : `No recording is open to ${what}.` });
    return false;
  };

  if (typeof settings.seek === 'number' && Number.isFinite(settings.seek) && needsOpen('seek')) {
    const seconds = Math.min(duration, Math.max(0, settings.seek));
    steps.push({ kind: 'seek', seconds });
    outcomes.push({ ok: true, message: `Moved to ${round(seconds, 1)} s of ${round(duration, 1)} s.` });
  }
  if (settings.speed !== undefined && needsOpen('change the speed')) {
    if (typeof settings.speed === 'number' && SPEEDS.includes(settings.speed)) {
      steps.push({ kind: 'speed', speed: settings.speed });
      outcomes.push({ ok: true, message: `Playback speed ${settings.speed}×.` });
    } else outcomes.push({ ok: false, message: `Playback speed must be one of ${SPEEDS.join(', ')}.` });
  }
  if (typeof settings.loop === 'boolean' && needsOpen('change looping')) {
    steps.push({ kind: 'loop', loop: settings.loop });
    outcomes.push({ ok: true, message: settings.loop ? 'Looping the recording.' : 'Not looping.' });
  }
  if (typeof settings.play === 'boolean' && needsOpen(settings.play ? 'play' : 'pause')) {
    steps.push({ kind: 'play', playing: settings.play });
    outcomes.push({ ok: true, message: settings.play ? 'Playing.' : 'Paused.' });
  }

  const sample = typeof settings.sample === 'string' ? [settings.sample] : Array.isArray(settings.sample) ? settings.sample : null;
  if (sample && needsOpen('sample')) {
    const topics = replay.info!.topics;
    const names = sample.filter((name): name is string => typeof name === 'string');
    const found = names.map(name => topics.find(topic => topic.name === name)).filter((topic): topic is NonNullable<typeof topic> => Boolean(topic && !topic.error));
    const missing = names.filter(name => !found.some(topic => topic.name === name));
    if (found.length) {
      steps.push({ kind: 'sample', topics: found.slice(0, SAMPLE_LIMIT).map(topic => ({ name: topic.name, type: topic.type })) });
      outcomes.push({ ok: true, message: `Read ${found.slice(0, SAMPLE_LIMIT).map(topic => topic.name).join(', ')} at the cursor.` });
    }
    if (found.length > SAMPLE_LIMIT) outcomes.push({ ok: false, message: `At most ${SAMPLE_LIMIT} topics are sampled at once.` });
    if (missing.length) outcomes.push({ ok: false, message: `The recording has no readable topic ${missing.join(', ')}.` });
  }

  if (settings.read !== undefined && needsOpen('read')) {
    const request = (settings.read && typeof settings.read === 'object' && !Array.isArray(settings.read) ? settings.read : {}) as Record<string, unknown>;
    const names = typeof request.topics === 'string' ? [request.topics] : Array.isArray(request.topics) ? request.topics.filter((name): name is string => typeof name === 'string') : [];
    const topics = replay.info!.topics;
    const found = names.map(name => topics.find(topic => topic.name === name && !topic.error)).filter((topic): topic is NonNullable<typeof topic> => Boolean(topic));
    const missing = names.filter(name => !found.some(topic => topic.name === name));
    const seconds = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(duration, Math.max(0, value)) : fallback);
    const fromSec = seconds(request.fromSec, 0);
    const toSec = seconds(request.toSec, duration);
    if (!found.length) outcomes.push({ ok: false, message: names.length ? `The recording has no readable topic ${names.join(', ')}.` : 'Name the topics to read.' });
    else if (toSec < fromSec) outcomes.push({ ok: false, message: 'The end of the stretch to read comes before its start.' });
    else {
      const read: RecordingReadRequest = {
        topics: found.slice(0, SAMPLE_LIMIT).map(topic => topic.name),
        fromSec,
        toSec,
        limit: typeof request.limit === 'number' && request.limit > 0 ? Math.min(READ_LIMIT, Math.floor(request.limit)) : 100,
        ...(typeof request.everySec === 'number' && request.everySec > 0 ? { everySec: request.everySec } : {}),
        ...(Array.isArray(request.fields) ? { fields: request.fields.filter((path): path is string => typeof path === 'string').slice(0, 12) } : {}),
        ...(typeof request.match === 'string' && request.match.trim() ? { match: request.match.trim() } : {}),
      };
      steps.push({ kind: 'read', request: read });
      outcomes.push({ ok: true, message: `Read ${read.topics.join(', ')} from ${round(fromSec, 1)} s to ${round(toSec, 1)} s.` });
      if (missing.length) outcomes.push({ ok: false, message: `The recording has no readable topic ${missing.join(', ')}.` });
      if (found.length > SAMPLE_LIMIT) outcomes.push({ ok: false, message: `At most ${SAMPLE_LIMIT} topics are read at once.` });
    }
  }

  let options = input.options;
  if (settings.recordOptions && typeof settings.recordOptions === 'object' && !Array.isArray(settings.recordOptions)) {
    const requested = settings.recordOptions as Record<string, unknown>;
    const defaults = defaultRecordOptions();
    const patch: Partial<RecordOptions> = {};
    const refused: string[] = [];
    for (const [key, value] of Object.entries(requested)) {
      if (!(key in defaults)) { refused.push(key); continue; }
      const field = key as keyof RecordOptions;
      if (field === 'topics') {
        if (Array.isArray(value)) patch.topics = [...new Set(value.filter((item): item is string => typeof item === 'string' && item.startsWith('/')))];
        else refused.push(key);
      } else if (field === 'name') {
        if (typeof value === 'string' && NAME_PATTERN.test(value) && value.length <= 128) patch.name = value;
        else refused.push('name (letters, digits, "_", "." and "-", starting with a letter or digit)');
      } else if (field === 'compression') {
        if (value === 'zstd' || value === 'none') patch.compression = value; else refused.push(key);
      } else if (field === 'qos') {
        if (value === 'auto' || value === 'reliable' || value === 'best_effort') patch.qos = value; else refused.push(key);
      } else if (typeof value === typeof defaults[field] && (typeof value !== 'number' || (Number.isFinite(value) && value >= 0))) {
        Object.assign(patch, { [field]: value });
      } else refused.push(key);
    }
    if (patch.topics && requested.allTopics === undefined) patch.allTopics = false;
    if (Object.keys(patch).length) {
      if (recorder.status?.state === 'recording' || recorder.status?.state === 'paused') {
        outcomes.push({ ok: false, message: 'Recording options cannot change while a recording runs; stop it first.' });
      } else {
        options = { ...options, ...patch };
        steps.push({ kind: 'tab', tab: 'record' }, { kind: 'options', patch });
        outcomes.push({ ok: true, message: `Set the recording options: ${Object.keys(patch).join(', ')}.` });
      }
    }
    if (refused.length) outcomes.push({ ok: false, message: `Not applied: ${refused.join(', ')}.` });
  }

  if (typeof settings.recorder === 'string') {
    const command = settings.recorder;
    const state = recorder.status?.state;
    const busy = state === 'recording' || state === 'paused' || state === 'stopping';
    let refusal = '';
    if (!['start', 'stop', 'pause', 'resume', 'split'].includes(command)) refusal = `The recorder has no "${command}" command.`;
    else if (!input.connected) refusal = 'Connect to ROS to use the recorder.';
    else if (!recorder.online) refusal = 'The recorder on the ROS host is not answering.';
    else if (recorder.pending) refusal = 'The recorder is still answering the previous request.';
    else if (command === 'start' && busy) refusal = 'A recording is already running.';
    else if (command === 'start' && !options.allTopics && !options.topics.length && !options.include) refusal = 'Choose topics to record, or record all topics.';
    else if (command !== 'start' && !busy) refusal = 'No recording is running.';
    else if (command === 'pause' && state !== 'recording') refusal = 'The recording is not running.';
    else if (command === 'resume' && state !== 'paused') refusal = 'The recording is not paused.';
    if (refusal) outcomes.push({ ok: false, message: refusal });
    else {
      steps.push({ kind: 'tab', tab: 'record' }, { kind: 'recorder', command: command as 'start', ...(command === 'start' ? { options } : {}) });
      outcomes.push({
        ok: true,
        message: {
          start: `Started recording ${options.allTopics ? 'all topics' : options.topics.join(', ') || `topics matching ${options.include}`} to ${options.name} on the ROS host.`,
          stop: 'Stopping and saving the recording.',
          pause: 'Paused the recording.',
          resume: 'Resumed the recording.',
          split: 'Started a new file in the recording.',
        }[command as 'start'],
      });
    }
  }

  const ignored = Object.keys(settings).filter(key => !KNOWN_KEYS.has(key));
  if (ignored.length) outcomes.push({ ok: false, message: `Record & Replay has no setting ${ignored.map(key => `"${key}"`).join(', ')}.` });
  if (!outcomes.length) outcomes.push({ ok: false, message: `Nothing in those settings applies to Record & Replay. ${RECORD_REPLAY_SETTINGS_HELP}` });
  return { steps, outcomes };
}

/**
 * The latest message of each topic at the playback cursor. The replay source hands a new
 * subscriber the last message before the cursor, so one message per topic is enough; a topic
 * with nothing recorded before the cursor reports that instead of waiting.
 */
export async function sampleRecording(
  ros: Ros,
  topics: { name: string; type: string }[],
  atSeconds: number,
  timeoutMs = 2500
): Promise<RecordingSample[]> {
  return Promise.all(
    topics.map(
      topic =>
        new Promise<RecordingSample>(resolve => {
          const subscriber = new ROSLIB.Topic({ ros, name: topic.name, messageType: topic.type, queue_length: 1 });
          const finish = (sample: Omit<RecordingSample, 'topic' | 'type' | 'atSeconds'>) => {
            clearTimeout(timer);
            subscriber.unsubscribe();
            resolve({ topic: topic.name, type: topic.type, atSeconds, ...sample });
          };
          const timer = setTimeout(() => finish({ unavailable: 'No message of this topic at or before this position.' }), timeoutMs);
          subscriber.subscribe(message => {
            const preview = boundedPreview(message, 400, 8000);
            finish({ value: preview.value, shortened: preview.truncated || undefined });
          });
        })
    )
  );
}

export const RECORD_REPLAY_CAPABILITY: AssistantCapability = {
  id: 'record-replay',
  summary:
    'When a Record & Replay panel is open you see the open MCAP recording (every topic with type, message count, average rate and definition, and the playback position), the recordings stored on the ROS host, and the recorder\'s state and options. You can open a recording from the ROS host, play, pause, seek, change speed and looping, read the messages of chosen topics at any position, set recording options, and start, pause, resume, split or stop a recording on the ROS host when the user asks.',
  detail: [
    'Do it with "configurePanel" on the open "recordReplay" panel (its settingsHelp lists the keys); with none open, add one and configure it in the same operations list.',
    'Sampled messages arrive in the panel\'s settings on the next turn: return the sampling request with the question in "followUp".',
    'A file on this device can only be opened by the user (drop it on the panel or choose it); say so instead of trying.',
  ],
  invocations: [
    'what is in this rosbag',
    'how long is the recording and which topics does it have',
    'show me /odom at 30 seconds into the recording',
    'play the recording at 2x',
    'record /scan and /odom for the next run',
    'stop the recording',
  ],
  responseKind: 'workspaceEdit',
};

/** The value at a dot/index path such as "pose.position.x" or "ranges[3]"; undefined when absent. */
export function valueAt(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(/[.[\]]/).filter(Boolean)) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

type ReadRange = (
  startSec: number,
  endSec: number,
  topics: string[],
  keep: (message: { topic: string; time: bigint; message: Record<string, unknown> }) => boolean | 'stop'
) => Promise<{ complete: boolean }>;

/**
 * Reads a stretch of the recording for the assistant: down-sampled, filtered and cut to a size a
 * prompt can carry, and stopped after a few seconds so a long remote recording cannot stall a turn.
 * Matches past the returned limit are still counted, so "how many errors" has a true answer.
 */
export async function readRecording(
  readRange: ReadRange,
  request: RecordingReadRequest,
  startTime: bigint,
  now: () => number = () => performance.now()
): Promise<RecordingReadResult> {
  const result: RecordingReadResult = { ...request, scanned: 0, matched: 0, messages: [] };
  const lastKept = new Map<string, bigint>();
  const interval = request.everySec ? BigInt(Math.round(request.everySec * 1e9)) : 0n;
  const match = request.match?.toLowerCase();
  const deadline = now() + READ_SECONDS * 1000;
  let chars = 0;
  let at = request.fromSec;
  try {
    const { complete } = await readRange(request.fromSec, request.toSec, request.topics, item => {
      at = Number(item.time - startTime) / 1e9;
      if (++result.scanned > SCAN_LIMIT) { result.stoppedBecause = `read ${SCAN_LIMIT.toLocaleString('en')} messages`; return 'stop'; }
      if (now() > deadline) { result.stoppedBecause = `took more than ${READ_SECONDS} s`; return 'stop'; }
      const previous = lastKept.get(item.topic);
      if (interval && previous !== undefined && item.time - previous < interval) return true;
      if (match && !JSON.stringify(item.message).toLowerCase().includes(match)) return true;
      result.matched += 1;
      lastKept.set(item.topic, item.time);
      if (result.messages.length >= request.limit || chars >= READ_CHARS) return true;
      const picked = request.fields?.length
        ? Object.fromEntries(request.fields.map(path => [path, valueAt(item.message, path)]))
        : item.message;
      const value = boundedPreview(picked, 80, 1500).value;
      chars += JSON.stringify(value)?.length ?? 0;
      result.messages.push({ topic: item.topic, atSec: round(at, 3), value });
      return true;
    });
    if (!complete) result.stoppedAtSec = round(at, 2);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}
