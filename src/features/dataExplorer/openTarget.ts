import type { RoboBoyJsonObject } from '../../panels/types';
import type { VisualizationPanelState } from '../../utils/visualizationState';
import { defaultRecordOptions } from '../recordReplay/types';
import { sanitizeConfig as sanitizeTimeSeriesConfig } from '../timeSeries/config';
import type { ExplorerOpenRequest } from './DataExplorerPanel';

/*
 * What a panel opened from the Data Explorer should hold. `previous` is the settings of the same kind
 * of panel when one is already open; the request is added to them, so opening a topic never wipes
 * what the user set up there.
 */

/** Time Series settings with the requested field plotted, keeping the lines already there. */
export function timeSeriesValuesFor(previous: RoboBoyJsonObject | undefined, request: ExplorerOpenRequest) {
  const current = sanitizeTimeSeriesConfig(previous?.config);
  const fieldPath = request.fieldPath ?? '';
  const present = current.series.some(series => series.topic === request.topic && series.fieldPath === fieldPath);
  return {
    config: sanitizeTimeSeriesConfig({
      ...current,
      series: present
        ? current.series
        : [...current.series, { topic: request.topic, messageType: request.messageType, fieldPath }],
    }) as unknown as RoboBoyJsonObject,
  } satisfies RoboBoyJsonObject;
}

/** Record & Replay settings on the record view with the requested topics added to the chosen ones. */
export function recordValuesFor(previous: RoboBoyJsonObject | undefined, request: ExplorerOpenRequest) {
  const options = previous?.options;
  const current = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  // "All topics" is replaced by an explicit list; a list chosen before is kept.
  const chosen =
    Array.isArray(current.topics) && current.allTopics === false
      ? current.topics.filter((topic): topic is string => typeof topic === 'string')
      : [];
  return {
    version: 1,
    initialTab: 'record',
    options: {
      ...defaultRecordOptions(),
      ...current,
      allTopics: false,
      topics: [...new Set([...chosen, ...(request.topics ?? [request.topic])])],
    } as unknown as RoboBoyJsonObject,
  } satisfies RoboBoyJsonObject;
}

/** 3D settings with a layer for the requested topic, unless that layer already exists. */
export function visualizationStateFor(
  current: VisualizationPanelState,
  request: ExplorerOpenRequest,
  createId: () => string
): VisualizationPanelState {
  if (!request.visualizationType) return current;
  const present = current.visualizations.some(
    item => item.type === request.visualizationType && item.topic === request.topic
  );
  return present
    ? current
    : {
        ...current,
        visualizations: [
          ...current.visualizations,
          { id: createId(), type: request.visualizationType, topic: request.topic },
        ],
      };
}
