import { useEffect, useRef, useState } from 'react';
import ROSLIB, { Ros } from 'roslib';

const MAX_ROSOUT_ENTRIES = 200;

export interface RosoutEntry {
  level: number;
  name: string;
  message: string;
  receivedAt: number;
}

interface RawRosoutMessage {
  level?: unknown;
  name?: unknown;
  msg?: unknown;
}

const parseRosoutMessage = (raw: unknown): RosoutEntry | null => {
  if (!raw || typeof raw !== 'object') return null;
  const message = raw as RawRosoutMessage;
  if (typeof message.msg !== 'string') return null;
  return {
    level: typeof message.level === 'number' ? message.level : 0,
    name: typeof message.name === 'string' ? message.name : 'unknown',
    message: message.msg,
    receivedAt: Date.now(),
  };
};

/**
 * Bounded (≤200 entries) `/rosout` ring buffer, subscribed only while `isActive` is true (the
 * assistant panel is open) and released otherwise — no existing subscription covers `/rosout`
 * today (it is explicitly filtered out of ROS discovery lists elsewhere), and diagnosing
 * post-reconnect ROS errors is an explicit assistant use case. `/rosout`'s exact field names are
 * shared between ROS1 `rosgraph_msgs/Log` and ROS2 `rcl_interfaces/msg/Log`, so no distro
 * branching is needed for this reduced field set.
 */
export const useRosoutBuffer = (ros: Ros | null, isActive: boolean): RosoutEntry[] => {
  const [entries, setEntries] = useState<RosoutEntry[]>([]);
  const entriesRef = useRef<RosoutEntry[]>([]);

  useEffect(() => {
    if (!ros || !isActive) return;
    entriesRef.current = [];
    setEntries([]);

    const topic = new ROSLIB.Topic({ ros, name: '/rosout', messageType: 'rcl_interfaces/msg/Log', queue_length: 20 });
    const handleMessage = (message: unknown) => {
      const parsed = parseRosoutMessage(message);
      if (!parsed) return;
      const next = [...entriesRef.current, parsed].slice(-MAX_ROSOUT_ENTRIES);
      entriesRef.current = next;
      setEntries(next);
    };
    topic.subscribe(handleMessage);

    return () => {
      topic.unsubscribe();
    };
  }, [ros, isActive]);

  return entries;
};
