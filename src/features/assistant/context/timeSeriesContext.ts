import type { ROSDiscoveryResult } from '../../behaviorTree/types';

/** Only sources the user asked to plot; never subscribe to the whole graph for context. */
export function timeSeriesContextTopics(text: string, topics: ROSDiscoveryResult['topics']) {
  if (!/\bplot|\bgraph|\bchart|\btime[\s-]?series\b|\btimeseries?\b|\bjoints?[ _-]?states?\b/i.test(text)) return [];
  const named = topics.filter(topic =>
    text.split(/[\s,;()"'`]+/).some(word => word.replace(/[.!?]$/, '') === topic.name)
  );
  if (named.length) return named.slice(0, 3);
  if (/\bjoints?[ _-]?states?\b/i.test(text)) {
    return topics.filter(topic => /^sensor_msgs\/(?:msg\/)?JointState$/.test(topic.type)).slice(0, 3);
  }
  return [];
}
