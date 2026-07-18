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
import chalk from 'chalk';
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
  /** Counted progress bars and non-interactive terminal summaries. */
  stream?: NodeJS.WriteStream;
  /** Ephemeral status output; defaults to stderr. */
  statusStream?: NodeJS.WriteStream;
  /** Override terminal detection, primarily for host adapters and tests. */
  isTTY?: boolean;
  /** Progress-bar implementation, primarily for deterministic tests. */
  factory?: ProgressBarFactory;
}

interface BarState {
  bar: ProgressBar;
  total: number;
}

/** A pull series bar, plus the last facts needed to re-pad its label on realign. */
interface PullBarState {
  bar: ProgressBar;
  total: number;
  base: string;
  status: string;
  value: number;
  unit: string;
}

const TERMINAL_STATUSES: Set<ProgressStatus> = new Set<ProgressStatus>([
  'done',
  'unconfirmed',
  'stalled',
  'timeout',
  'error',
]);

const INSPECTION_FRAMES: readonly string[] = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
const INSPECTION_FRAME_MS: number = 80;

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

/**
 * Width of the status column, so the bars line up whatever the status. Sized to
 * the widest label ({@link status_label}) — `[UNCONFIRMED]` — and reserved even
 * while a series has no terminal status yet, so the bar never shifts.
 */
const PULL_STATUS_WIDTH: number = Math.max(
  ...(['done', 'unconfirmed', 'stalled', 'timeout', 'error'] as ProgressStatus[]).map(
    (s: ProgressStatus): number => status_label(s).length,
  ),
);

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
  private readonly statusStream: NodeJS.WriteStream;
  private readonly isTTY: boolean;
  private readonly inspectionIsTTY: boolean;
  private readonly factory: ProgressBarFactory;
  private readonly transferBars: Map<ProgressOperation, BarState> = new Map<ProgressOperation, BarState>();
  private readonly pullBars: Map<string, PullBarState> = new Map<string, PullBarState>();
  private pullMultiBar: MultiBarInstance | null = null;
  private pullBaseWidth: number = 0;
  private inspectionInterval: NodeJS.Timeout | null = null;
  private inspectionFrameIndex: number = 0;
  private inspectionLabel: string = '';

  constructor(options: ProgressRendererOptions = {}) {
    this.stream = options.stream ?? process.stdout;
    this.statusStream = options.statusStream ?? process.stderr;
    this.isTTY = options.isTTY ?? !!this.stream.isTTY;
    this.inspectionIsTTY = this.isTTY && !!this.statusStream.isTTY;
    this.factory = options.factory ?? defaultFactory_get();
  }

  public write(event: ProgressEvent): void {
    if (event.operation === 'pipeline' || event.kind === 'inspection') {
      if (this.inspectionIsTTY) this.inspection_write(event);
      return;
    }

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
        this.pullBaseWidth = 0;
      }
      return;
    }

    this.transfer_write(event);
  }

  public clear(): void {
    this.inspection_stop();
    for (const state of this.transferBars.values()) {
      state.bar.stop?.();
    }
    this.transferBars.clear();
    this.pullMultiBar?.stop();
    this.pullMultiBar = null;
    this.pullBars.clear();
    this.pullBaseWidth = 0;
  }

  private inspection_write(event: ProgressEvent): void {
    if (event.phase === 'complete' || event.phase === 'failed') {
      this.inspection_stop();
      return;
    }
    this.inspectionLabel = event.label ?? 'Reading registered pipeline…';
    if (this.inspectionInterval !== null) return;
    this.inspectionFrameIndex = 0;
    this.statusStream.write('\x1B[?25l');
    this.inspection_render();
    this.inspectionInterval = setInterval((): void => {
      this.inspectionFrameIndex = (this.inspectionFrameIndex + 1) % INSPECTION_FRAMES.length;
      this.inspection_render();
    }, INSPECTION_FRAME_MS);
  }

  private inspection_render(): void {
    const frame: string = INSPECTION_FRAMES[this.inspectionFrameIndex];
    this.statusStream.write(`\r\x1b[K${chalk.cyanBright(frame)} ${chalk.gray(this.inspectionLabel)}`);
  }

  private inspection_stop(): void {
    if (this.inspectionInterval === null) return;
    clearInterval(this.inspectionInterval);
    this.inspectionInterval = null;
    this.statusStream.write('\r\x1b[K');
    this.statusStream.write('\x1B[?25h');
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
    const base: string = event.label ?? event.operation;
    const status: string = status_label(event.status);
    const total: number = event_total(event);
    const value: number = event_current(event);
    const unit: string = event.unit ?? '';

    // Grow the shared name column so every bar starts at the same column; when it
    // grows, re-pad the already-drawn bars (including finished ones) to match.
    const grew: boolean = base.length > this.pullBaseWidth;
    if (grew) this.pullBaseWidth = base.length;

    const state: PullBarState | undefined = this.pullBars.get(key);
    if (!state) {
      const bar: ProgressBar = this.pullMultiBar.create(total, value, { label: this.pull_label(base, status), unit });
      this.pullBars.set(key, { bar, total, base, status, value, unit });
    } else {
      if (total !== state.total) {
        state.bar.setTotal(total);
        state.total = total;
      }
      state.base = base;
      state.status = status;
      state.value = value;
      state.unit = unit;
      state.bar.update(value, { label: this.pull_label(base, status), unit });
    }

    if (grew) this.pullBars_realign(key);
  }

  /** Formats a pull label as fixed-width `name` + `status` columns, so bars align. */
  private pull_label(base: string, status: string): string {
    return `${base.padEnd(this.pullBaseWidth)} ${status.padEnd(PULL_STATUS_WIDTH)}`;
  }

  /** Re-renders every pull bar except `exceptKey` at the current column width. */
  private pullBars_realign(exceptKey: string): void {
    for (const [key, state] of this.pullBars) {
      if (key === exceptKey) continue;
      state.bar.update(state.value, { label: this.pull_label(state.base, state.status), unit: state.unit });
    }
  }
}
