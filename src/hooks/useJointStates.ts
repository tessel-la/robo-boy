import { useEffect, useState } from 'react';
import * as ROSLIB from 'roslib';
import { isReplayRos } from '../features/recordReplay/ReplaySession';
import { parseJointLimits, parseJointState, type JointLimits, type JointSample } from '../utils/jointStates';

/** Source-owned observer subscriptions: the supplied ROS facade also owns replay/seek isolation. */
export function useJointStates(ros: ROSLIB.Ros | null, topic: string, messageType: string, descriptionTopic: string) {
  const [state, setState] = useState<{ joints: JointSample[]; error: string | null }>({ joints: [], error: null });
  const [description, setDescription] = useState<{
    limits: Record<string, JointLimits>;
    error: string | null;
    loaded: boolean;
  }>({
    limits: {},
    error: null,
    loaded: false,
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setState({ joints: [], error: null });
    if (!ros) return;
    let active = true;
    const samples = new Map<string, JointSample>();
    const subscription = new ROSLIB.Topic({ ros, name: topic, messageType, throttle_rate: 100, queue_length: 1 });
    subscription.subscribe(message => {
      if (!active) return;
      try {
        const updates = parseJointState(message, Date.now());
        for (const sample of updates) {
          samples.delete(sample.name);
          samples.set(sample.name, sample);
        }
        while (samples.size > 2048) samples.delete(samples.keys().next().value!);
        setState({ joints: [...samples.values()].sort((a, b) => a.name.localeCompare(b.name)), error: null });
        setNow(Date.now());
      } catch (error) {
        setState(previous => ({ ...previous, error: (error as Error).message }));
      }
    });
    const timer = isReplayRos(ros) ? undefined : setInterval(() => setNow(Date.now()), 500);
    return () => {
      active = false;
      subscription.unsubscribe();
      clearInterval(timer);
    };
  }, [ros, topic, messageType]);
  useEffect(() => {
    setDescription({ limits: {}, error: null, loaded: false });
    if (!ros || !descriptionTopic) return;
    let active = true;
    const subscription = new ROSLIB.Topic({
      ros,
      name: descriptionTopic,
      messageType: 'std_msgs/String',
      queue_length: 1,
    });
    subscription.subscribe((message: unknown) => {
      if (!active) return;
      try {
        setDescription({ limits: parseJointLimits((message as { data?: unknown })?.data), error: null, loaded: true });
      } catch (error) {
        setDescription({ limits: {}, error: (error as Error).message, loaded: false });
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [ros, descriptionTopic]);
  return {
    joints: state.joints,
    limits: description.limits,
    descriptionError: description.error,
    descriptionLoaded: description.loaded,
    messageError: state.error,
    now,
    replay: !!ros && isReplayRos(ros),
  };
}
