import type { Ros } from 'roslib';
import type { TimeseriesConfig } from './config';
import type { TimeSeriesEngine } from './engine';
import { createPanelPresentationRegistry } from '../../panels/presentationRegistry';

/** A second view of a mounted tile shares its history, replay clock and subscription owner. */
export interface TimeSeriesPresentation {
  readonly engine: TimeSeriesEngine;
  readonly ros: Ros | null;
  readonly connected: boolean;
  readonly error: string;
  configure(config: TimeseriesConfig): void;
  /** Keep acquisition alive while the desktop surface is out of view; suspend its drawing. */
  setPresented(presented: boolean): void;
}

const registry = createPanelPresentationRegistry<TimeSeriesPresentation>();
export const registerTimeSeriesPresentation = registry.register;
export const getTimeSeriesPresentation = registry.get;
