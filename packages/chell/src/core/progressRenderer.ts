/**
 * @file Terminal renderer for semantic progress events.
 *
 * Producers emit facts. This renderer is the terminal-only adapter that turns
 * those facts into bars when attached to a TTY, or into low-noise status lines
 * when output is not interactive.
 *
 * @module
 */
import cliProgress from 'cli-progress';
import type { ProgressEvent, ProgressOperation, ProgressStatus, ProgressRenderer } from '@fnndsc/brasa';

type ProgressBar = {
  update(value: number, payload?: Record<string, string>): void;
  setTotal(total: number): void;
  stop?(): void;
};

type SingleBarCtor = new (options: Record<string, unknown>, preset: unknown) => ProgressBar & {
  start(total: number, startValue: number, payload?: Record<string, string>): void;
};

type MultiBarInstance = {
  create(total: number, startValue: number, payload?: Record<string, string>): ProgressBar;
  remove(bar: ProgressBar): void;
  stop(): void;
};

type MultiBarCtor = new (options: Record<string, unknown>, preset: unknown) => MultiBarInstance;

export interface ProgressBarFactory {
  SingleBar: SingleBarCtor;
  MultiBar: MultiBarCtor;
  preset: unknown;
}

export interface ProgressRendererOptions {
  stream?: NodeJS.WriteStream;
  isTTY?: boolean;
  factory?: ProgressBarFactory;
}

interface BarState {
  bar: ProgressBar;
  total: number;
}

const TERMINAL_STATUSES: Set<ProgressStatus> = new Set<ProgressStatus>([
  'done',
  'unconfirmed',
  'stalled',
  'timeout',
  'error',
]);

function defaultFactory_get(): ProgressBarFactory {
  return {
    SingleBar: cliProgress.SingleBar as unknown as SingleBarCtor,
    MultiBar: cliProgress.MultiBar as unknown as MultiBarCtor,
    preset: cliProgress.Presets.shades_classic,
  };
}

function event_total(event: ProgressEvent): number {
  const current: number = event.current ?? 0;
  return Math.max(event.total ?? current, current, 1);
}

function event_current(event: ProgressEvent): number {
  return Math.min(event.current ?? 0, event_total(event));
}

function event_label(event: ProgressEvent): string {
  const base: string = event.label ?? event.operation;
  const statusLabel: string = status_label(event.status);
  return statusLabel ? `${base} ${statusLabel}` : base;
}

function status_label(status: ProgressStatus | undefined): string {
  if (status === 'done') return '[DONE]';
  if (status === 'unconfirmed') return '[UNCONFIRMED]';
  if (status === 'stalled') return '[STALLED]';
  if (status === 'timeout') return '[TIMEOUT]';
  if (status === 'error') return '[ERROR]';
  return '';
}

function fallback_shouldPrint(event: ProgressEvent): boolean {
  if (event.phase === 'complete' || event.phase === 'failed') return true;
  return event.status !== undefined && TERMINAL_STATUSES.has(event.status);
}

function fallback_line(event: ProgressEvent): string {
  const parts: string[] = [event.operation];
  if (event.label) parts.push(event.label);
  if (event.status) parts.push(event.status);
  if (event.current !== undefined && event.total !== undefined) {
    parts.push(`${event.current}/${event.total}`);
  } else if (event.current !== undefined) {
    parts.push(`${event.current}`);
  }
  if (event.unit) parts.push(event.unit);
  return `${parts.join(' ')}\n`;
}

/**
 * Renders semantic progress to a terminal.
 */
export class TerminalProgressRenderer implements ProgressRenderer {
  private readonly stream: NodeJS.WriteStream;
  private readonly isTTY: boolean;
  private readonly factory: ProgressBarFactory;
  private readonly transferBars: Map<ProgressOperation, BarState> = new Map<ProgressOperation, BarState>();
  private readonly pullBars: Map<string, BarState> = new Map<string, BarState>();
  private pullMultiBar: MultiBarInstance | null = null;

  constructor(options: ProgressRendererOptions = {}) {
    this.stream = options.stream ?? process.stdout;
    this.isTTY = options.isTTY ?? !!this.stream.isTTY;
    this.factory = options.factory ?? defaultFactory_get();
  }

  public write(event: ProgressEvent): void {
    if (!this.isTTY) {
      if (fallback_shouldPrint(event)) {
        this.stream.write(fallback_line(event));
      }
      return;
    }

    if (event.operation === 'pull') {
      if (event.itemId) {
        this.pull_write(event);
      } else if (event.phase === 'complete' || event.phase === 'failed') {
        this.pullMultiBar?.stop();
        this.pullMultiBar = null;
        this.pullBars.clear();
      }
      return;
    }

    this.transfer_write(event);
  }

  public clear(): void {
    for (const state of this.transferBars.values()) {
      state.bar.stop?.();
    }
    this.transferBars.clear();
    this.pullMultiBar?.stop();
    this.pullMultiBar = null;
    this.pullBars.clear();
  }

  private transfer_write(event: ProgressEvent): void {
    if (event.phase === 'complete' || event.phase === 'failed') {
      const existing: BarState | undefined = this.transferBars.get(event.operation);
      if (existing) {
        existing.bar.update(event_current(event), { label: event_label(event), unit: event.unit ?? '' });
        existing.bar.stop?.();
        this.transferBars.delete(event.operation);
      } else {
        this.stream.write(fallback_line(event));
      }
      return;
    }

    const total: number = event_total(event);
    let state: BarState | undefined = this.transferBars.get(event.operation);
    if (!state) {
      const bar = new this.factory.SingleBar({
        format: ' {label} [{bar}] {value}/{total} {unit}',
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: false,
      }, this.factory.preset);
      bar.start(total, event_current(event), { label: event_label(event), unit: event.unit ?? '' });
      state = { bar, total };
      this.transferBars.set(event.operation, state);
      return;
    }

    if (total !== state.total) {
      state.bar.setTotal(total);
      state.total = total;
    }
    state.bar.update(event_current(event), { label: event_label(event), unit: event.unit ?? '' });
  }

  private pull_write(event: ProgressEvent): void {
    if (!this.pullMultiBar) {
      this.pullMultiBar = new this.factory.MultiBar({
        format: ' {label} [{bar}] {value}/{total} {unit}',
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: false,
      }, this.factory.preset);
    }

    const key: string = event.itemId as string;
    const total: number = event_total(event);
    let state: BarState | undefined = this.pullBars.get(key);
    if (!state) {
      const bar: ProgressBar = this.pullMultiBar.create(total, event_current(event), {
        label: event_label(event),
        unit: event.unit ?? '',
      });
      state = { bar, total };
      this.pullBars.set(key, state);
      return;
    }

    if (total !== state.total) {
      state.bar.setTotal(total);
      state.total = total;
    }
    state.bar.update(event_current(event), { label: event_label(event), unit: event.unit ?? '' });
  }
}
