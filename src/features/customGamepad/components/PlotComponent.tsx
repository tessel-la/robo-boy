import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ros, Topic } from 'roslib';
import ROSLIB from 'roslib';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';
import {
  getNumericValueAtPath,
  getPlotRange,
  PlotSample,
  trimPlotSamples,
} from '../rosMessageUtils';
import './DataDisplayComponents.css';

interface PlotComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

const PlotComponent: React.FC<PlotComponentProps> = ({ config, ros, isEditing = false, scaleFactor = 1 }) => {
  const topicRef = useRef<Topic | null>(null);
  const action = config.action as ROSTopicConfig | undefined;
  const fieldPaths = useMemo(() => {
    const configuredPaths = config.config?.fieldPaths?.filter(Boolean);
    if (configuredPaths && configuredPaths.length > 0) return configuredPaths;
    return [config.config?.fieldPath || action?.field || 'data'];
  }, [action?.field, config.config?.fieldPath, config.config?.fieldPaths]);
  const timeWindowSec = config.config?.timeWindowSec ?? 10;
  const sampleLimit = Math.max(120, Math.min(1000, Math.round(timeWindowSec * 30)));
  const autoScale = config.config?.autoScale !== false;
  const minY = config.config?.minY ?? -1;
  const maxY = config.config?.maxY ?? 1;
  const seriesSamplesRef = useRef<Record<string, PlotSample[]>>({});
  const animationFrameRef = useRef<number | null>(null);
  const statusRef = useRef('No plot topic selected');
  const [seriesSamples, setSeriesSamples] = useState<Record<string, PlotSample[]>>({});
  const [status, setStatus] = useState('No plot topic selected');

  const setStatusIfChanged = useCallback((nextStatus: string) => {
    if (statusRef.current === nextStatus) return;
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const flushSamples = useCallback(() => {
    animationFrameRef.current = null;
    setSeriesSamples({ ...seriesSamplesRef.current });
  }, []);

  const cancelPendingFlush = useCallback(() => {
    if (animationFrameRef.current !== null && window.cancelAnimationFrame) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = null;
  }, []);

  const scheduleFlush = useCallback(() => {
    if (animationFrameRef.current !== null) return;

    if (!window.requestAnimationFrame) {
      flushSamples();
      return;
    }

    animationFrameRef.current = -1;
    const frameId = window.requestAnimationFrame(flushSamples);
    if (animationFrameRef.current === -1) {
      animationFrameRef.current = frameId;
    }
  }, [flushSamples]);

  useEffect(() => {
    cancelPendingFlush();
    seriesSamplesRef.current = {};
    setSeriesSamples({});

    if (isEditing) {
      setStatusIfChanged('Plot preview');
      return;
    }

    if (!action?.topic || !action.messageType || fieldPaths.length === 0) {
      setStatusIfChanged('No plot topic selected');
      return;
    }

    if (!ros?.isConnected) {
      setStatusIfChanged('Connecting...');
      return;
    }

    const topic = new ROSLIB.Topic({
      ros,
      name: action.topic,
      messageType: action.messageType,
    });

    topic.subscribe((message: unknown) => {
      const now = Date.now();
      const nextValues = fieldPaths
        .map(path => ({ path, value: getNumericValueAtPath(message, path) }))
        .filter((item): item is { path: string; value: number } => item.value !== null);

      if (nextValues.length === 0) {
        setStatusIfChanged(`No numeric data at ${fieldPaths.join(', ')}`);
        return;
      }

      nextValues.forEach(({ path, value }) => {
        seriesSamplesRef.current[path] = trimPlotSamples(
          [...(seriesSamplesRef.current[path] ?? []), { time: now, value }],
          now,
          timeWindowSec,
          sampleLimit
        );
      });
      scheduleFlush();
      setStatusIfChanged('');
    });

    topicRef.current = topic;
    setStatusIfChanged('Waiting for data...');

    return () => {
      topic.unsubscribe();
      cancelPendingFlush();
      topicRef.current = null;
    };
  }, [
    action?.messageType,
    action?.topic,
    fieldPaths,
    isEditing,
    ros,
    ros?.isConnected,
    sampleLimit,
    cancelPendingFlush,
    scheduleFlush,
    setStatusIfChanged,
    timeWindowSec,
  ]);

  const plot = useMemo(() => {
    const width = 320;
    const height = 160;
    const chartLeft = 24;
    const chartRight = width - 12;
    const chartTop = 34;
    const chartBottom = fieldPaths.length > 1 ? height - 32 : height - 16;
    const allSamples = Object.values(seriesSamples).flat();
    const range = getPlotRange(allSamples, autoScale, minY, maxY);
    const latestTime = allSamples.reduce((latest, sample) => Math.max(latest, sample.time), 0) || Date.now();
    const oldestTime = allSamples.reduce((oldest, sample) => Math.min(oldest, sample.time), latestTime);
    const windowStart = latestTime - timeWindowSec * 1000;
    const minTime = Math.max(windowStart, oldestTime);
    const maxTime = latestTime;
    const rawTimeSpan = maxTime - minTime;
    const shouldStretchFlatSeries = rawTimeSpan < 50;
    const timeSpan = Math.max(50, rawTimeSpan);
    const valueSpan = Math.max(0.000001, range.max - range.min);
    const chartWidth = chartRight - chartLeft;
    const chartHeight = chartBottom - chartTop;

    const yForValue = (value: number) => {
      const y = chartBottom - ((value - range.min) / valueSpan) * chartHeight;
      return Math.max(chartTop, Math.min(chartBottom, y));
    };

    const series = fieldPaths.map((path, index) => {
      const samples = seriesSamples[path] ?? [];
      const points = shouldStretchFlatSeries && samples.length > 0
        ? `${chartLeft.toFixed(1)},${yForValue(samples[samples.length - 1].value).toFixed(1)} ${chartRight.toFixed(1)},${yForValue(samples[samples.length - 1].value).toFixed(1)}`
        : samples.map(sample => {
          const x = chartLeft + ((sample.time - minTime) / timeSpan) * chartWidth;
          const y = yForValue(sample.value);
          return `${Math.max(chartLeft, Math.min(chartRight, x)).toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
      return {
        path,
        color: PLOT_COLORS[index % PLOT_COLORS.length],
        points,
        latest: samples[samples.length - 1]?.value,
      };
    });

    return { width, height, chartLeft, chartRight, chartTop, chartBottom, series, range, hasSamples: allSamples.length > 0 };
  }, [autoScale, fieldPaths, maxY, minY, seriesSamples, timeWindowSec]);

  const fontSize = Math.max(10, Math.floor(12 * scaleFactor));

  return (
    <div className="data-display-component plot-pad-component" data-testid="plot-component">
      <div className="plot-header" style={{ fontSize }}>
        <span title={fieldPaths.join(', ')}>{fieldPaths.join(', ')}</span>
        {plot.series[0]?.latest !== undefined && <strong>{plot.series[0].latest.toFixed(3)}</strong>}
      </div>
      <svg
        className="plot-svg"
        viewBox={`0 0 ${plot.width} ${plot.height}`}
        role="img"
        aria-label={`Plot for ${fieldPaths.join(', ')}`}
        preserveAspectRatio="none"
      >
        <line x1={plot.chartLeft} y1={plot.chartBottom} x2={plot.chartRight} y2={plot.chartBottom} />
        <line x1={plot.chartLeft} y1={plot.chartTop} x2={plot.chartLeft} y2={plot.chartBottom} />
        {plot.series.map(series => (
          series.points && (
            <polyline
              key={series.path}
              points={series.points}
              style={{ stroke: series.color }}
            />
          )
        ))}
      </svg>
      {fieldPaths.length > 1 && (
        <div className="plot-legend" style={{ fontSize: Math.max(9, fontSize - 2) }}>
          {plot.series.map(series => (
            <span key={series.path} title={series.path}>
              <i style={{ backgroundColor: series.color }} />
              {series.path.split('.').pop()}
              {series.latest !== undefined ? ` ${series.latest.toFixed(2)}` : ''}
            </span>
          ))}
        </div>
      )}
      {(status || !plot.hasSamples) && (
        <div className="data-display-status" style={{ fontSize: Math.max(9, fontSize - 2) }}>
          {status || 'Waiting for data...'}
        </div>
      )}
    </div>
  );
};

const PLOT_COLORS = ['#32cd32', '#4dabf7', '#ffb020', '#f06595', '#b197fc', '#20c997'];

export default PlotComponent;
