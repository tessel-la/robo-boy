import { FiX } from 'react-icons/fi';
import { useEffect, useRef } from 'react';
import { displayName, type TimeseriesConfig } from './config';
import type { TimeseriesSample } from './data';
import { intervalStatistics } from './analysis';
import NumberSetting from './NumberSetting';

export interface AnalysisInterval {
  start: number;
  end: number;
  origin: number;
}
export default function IntervalStatistics({
  data,
  config,
  interval,
  onChange,
  onClose,
}: {
  data: ReadonlyMap<string, readonly TimeseriesSample[]>;
  config: TimeseriesConfig;
  interval: AnalysisInterval;
  onChange: (value: AnalysisInterval) => void;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);
  const invalid = interval.end < interval.start;
  const format = (value: number | null) => (value === null ? '—' : Number(value.toPrecision(6)).toString());
  return (
    <section
      className="timeseries-analysis"
      aria-label="Interval statistics"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <strong>Interval statistics</strong>
        <button ref={close} className="timeseries-icon-button" aria-label="Close interval statistics" onClick={onClose}>
          <FiX />
        </button>
      </header>
      <div className="timeseries-analysis-body">
        <div className="timeseries-grid">
          {(['start', 'end'] as const).map(key => (
            <NumberSetting
              key={key}
              label={key === 'start' ? 'Start (s)' : 'End (s)'}
              value={(interval[key] - interval.origin) / 1000}
              onChange={value => onChange({ ...interval, [key]: interval.origin + value * 1000 })}
            />
          ))}
        </div>
        <p>
          Seconds from this captured history's first sample. Values include configured math and filters; statistics are
          sample-weighted.
        </p>
        {invalid ? (
          <p role="alert">End must be at or after start.</p>
        ) : (
          <div className="timeseries-stat-table">
            <table>
              <thead>
                <tr>
                  {['Signal', 'Samples', 'Min', 'Max', 'Mean', 'RMS', 'Std dev', 'Change'].map(label => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {config.series
                  .filter(series => series.enabled || (config.mode === 'xy' && series.id === config.xSeriesId))
                  .map(series => {
                    const stats = intervalStatistics(data.get(series.id) ?? [], interval.start, interval.end);
                    return (
                      <tr key={series.id}>
                        <th scope="row">
                          {displayName(series)}
                          {series.unit ? ` (${series.unit})` : ''}
                        </th>
                        <td>{stats.count}</td>
                        {(['min', 'max', 'mean', 'rms', 'std', 'delta'] as const).map(key => (
                          <td key={key}>{format(stats[key])}</td>
                        ))}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        <p>
          Based on the frozen captured samples, bounded by the time window and sample limit. Close this view and use
          Reset / Live to follow incoming data.
        </p>
      </div>
    </section>
  );
}
