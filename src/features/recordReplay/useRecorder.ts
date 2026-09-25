import { useCallback, useEffect, useRef, useState } from 'react';
import ROSLIB, { type Ros, type Topic } from 'roslib';
import { v4 as uuidv4 } from 'uuid';
import type { RecorderStatus, RecordOptions } from './types';

export function useRecorder(ros: Ros | null, connected: boolean) {
  const [status, setStatus] = useState<RecorderStatus>();
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [folders, setFolders] = useState<{ directory: string; folders: string[]; recordings: string[] }>();
  const publisher = useRef<Topic>();
  const waiting = useRef<{ id: string; timer: ReturnType<typeof setTimeout> }>();
  useEffect(() => {
    setOnline(false); setPending(false); setStatus(undefined);
    if (!ros || !connected) return;
    const output = new ROSLIB.Topic({ ros, name: '/roboboy/recorder/command', messageType: 'std_msgs/msg/String' });
    const input = new ROSLIB.Topic({ ros, name: '/roboboy/recorder/status', messageType: 'std_msgs/msg/String', queue_length: 1 });
    publisher.current = output;
    let lastSeen = 0;
    input.subscribe(message => {
      try {
        const value = JSON.parse(message.data);
        if (value.version !== 1 || !['idle', 'recording', 'paused', 'stopping', 'error'].includes(value.state)) return;
        lastSeen = Date.now(); setOnline(true); setStatus(value);
        const request = waiting.current;
        if (request && request.id === value.requestId) {
          clearTimeout(request.timer); waiting.current = undefined; setPending(false);
          setError(value.requestError ?? '');
          if (!value.requestError && Array.isArray(value.folders)) setFolders({ directory: value.directory, folders: value.folders, recordings: Array.isArray(value.recordings) ? value.recordings : [] });
        }
      } catch { /* Ignore unrelated or malformed protocol messages. */ }
    });
    const heartbeat = setInterval(() => setOnline(Date.now() - lastSeen < 3500), 1000);
    return () => {
      clearInterval(heartbeat); clearTimeout(waiting.current?.timer); waiting.current = undefined;
      input.unsubscribe(); output.unadvertise(); publisher.current = undefined;
    };
  }, [ros, connected]);
  const command = useCallback((action: string, options?: RecordOptions, path?: string) => {
    if (!publisher.current || !online || waiting.current) return;
    const id = uuidv4();
    setPending(true); setError('');
    waiting.current = { id, timer: setTimeout(() => {
      waiting.current = undefined; setPending(false);
      setError('No acknowledgement from the recorder. Check its status before retrying.');
    }, 8000) };
    publisher.current.publish(new ROSLIB.Message({ data: JSON.stringify({ version: 1, id, action, options, path }) }));
  }, [online]);
  return { status, online, pending, error, folders, command };
}
