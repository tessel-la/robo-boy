import { useLayoutEffect, useRef } from 'react';
import { createPanelPresentationRegistry } from '../../panels/presentationRegistry';
import type { ReplaySession, ReplaySnapshot } from './ReplaySession';
import type { RemoteRecordingsState, RemoteRecordingFile } from './remoteRecordings';
import type { RecordOptions } from './types';
import type { useRecorder } from './useRecorder';

export interface RecordReplayPresentation {
  tab: 'replay' | 'record';
  replay: ReplaySnapshot;
  position: number;
  seek(position: number): void;
  session: ReplaySession;
  recorder: ReturnType<typeof useRecorder>;
  options: RecordOptions;
  topics: readonly string[];
  remote: RemoteRecordingsState;
  remotePath: string;
  setTab(tab: 'replay' | 'record'): void;
  changeOptions(patch: Partial<RecordOptions>): void;
  browse(path: string): void;
  refresh(): void;
  open(file: RemoteRecordingFile): void;
  start(): void;
}
const registry = createPanelPresentationRegistry<() => RecordReplayPresentation>();
export const getRecordReplayPresentation = registry.get;
export function useRecordReplayPresentation(
  id: string | undefined,
  scope: string | undefined,
  state: RecordReplayPresentation
) {
  const latest = useRef(state);
  latest.current = state;
  useLayoutEffect(() => (id ? registry.register(id, () => latest.current, scope) : undefined), [id, scope]);
}
