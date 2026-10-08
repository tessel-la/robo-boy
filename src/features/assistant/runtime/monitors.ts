import type { Ros } from 'roslib';
import * as ROSLIB from 'roslib';
import { getValueAtPath } from '../../customGamepad/rosMessageUtils';

export interface MonitorOptions {
  topic: string;
  fieldPath: string;
  comparison: 'above' | 'below' | 'equals' | 'changes';
  value?: number | string | boolean;
  messageType: string;
  durationMinutes: number;
  maxInferences: number;
}
export interface MonitorStatus {
  id: string;
  topic: string;
  fieldPath: string;
  expiresAt: number;
  remaining: number;
  status: 'watching' | 'analysing' | 'stopped';
  lastAlertAt?: number;
}

/** One bounded subscription, deterministic edge-triggering, no model polling. Any analysis
 * runs in a separate read-only scope and cannot restart itself or extend its allowance. */
export class TopicMonitor {
  readonly controller = new AbortController();
  readonly state: MonitorStatus;
  private topic: ROSLIB.Topic;
  private timer: ReturnType<typeof setTimeout>;
  private previous: unknown;
  private matched = false;
  private busy = false;
  constructor(
    ros: Ros,
    options: MonitorOptions,
    private changed: (state: MonitorStatus) => void,
    private analyse: (value: unknown, signal: AbortSignal) => Promise<void>
  ) {
    if (options.comparison !== 'changes' && options.value === undefined || ['above', 'below'].includes(options.comparison) && (typeof options.value !== 'number' || !Number.isFinite(options.value))) throw new Error('Threshold watches need an explicit finite numeric threshold; equality watches need a comparison value.');
    if (
      !Number.isInteger(options.durationMinutes) ||
      options.durationMinutes < 1 ||
      options.durationMinutes > 1440 ||
      !Number.isInteger(options.maxInferences) ||
      options.maxInferences < 1 ||
      options.maxInferences > 20
    )
      throw new Error('Monitor expiry and inference allowance must be explicit and bounded.');
    this.state = {
      id: crypto.randomUUID(),
      topic: options.topic,
      fieldPath: options.fieldPath,
      expiresAt: Date.now() + options.durationMinutes * 60_000,
      remaining: options.maxInferences,
      status: 'watching',
    };
    this.topic = new ROSLIB.Topic({
      ros,
      name: options.topic,
      messageType: options.messageType,
      throttle_rate: 1000,
      queue_length: 1,
    });
    this.timer = setTimeout(() => this.stop(), options.durationMinutes * 60_000);
    this.topic.subscribe(message => {
      if (this.controller.signal.aborted || this.busy || Date.now() >= this.state.expiresAt) return;
      try {
        if (new TextEncoder().encode(JSON.stringify(message)).byteLength > 24 * 1024) return;
      } catch {
        return;
      }
      const value = getValueAtPath(message, options.fieldPath);
      if (
        value === undefined ||
        (value !== null && typeof value === 'object') ||
        (typeof value === 'number' && !Number.isFinite(value))
      )
        return;
      const match =
        options.comparison === 'changes'
          ? this.previous !== undefined && value !== this.previous
          : options.comparison === 'equals'
            ? value === options.value
            : typeof value === 'number' &&
              typeof options.value === 'number' &&
              (options.comparison === 'above' ? value > options.value : value < options.value);
      this.previous = value;
      const rising = match && (!this.matched || options.comparison === 'changes');
      this.matched = match;
      if (
        !rising ||
        this.state.remaining <= 0 ||
        (this.state.lastAlertAt && Date.now() - this.state.lastAlertAt < 300_000)
      )
        return;
      this.busy = true;
      this.state.remaining--;
      this.state.lastAlertAt = Date.now();
      this.state.status = 'analysing';
      this.changed({ ...this.state });
      void this.analyse(value, this.controller.signal)
        .catch(() => {})
        .finally(() => {
          this.busy = false;
          if (!this.controller.signal.aborted) {
            this.state.status = 'watching';
            this.changed({ ...this.state });
            if (!this.state.remaining) this.stop();
          }
        });
    });
    this.changed({ ...this.state });
  }
  stop(): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort();
    clearTimeout(this.timer);
    this.topic.unsubscribe();
    this.state.status = 'stopped';
    this.changed({ ...this.state });
  }
}
