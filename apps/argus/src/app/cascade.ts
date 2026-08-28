/**
 * @file The data cascade: the LCARS top panel's number field, fed by truth.
 *
 * The cascade used to be generated noise — random figures flickering on a
 * timer so the panel read as alive. It now renders live session telemetry:
 * the clock, the session uptime, the daemon's process-index warm-up, command
 * latency, and the typed progress channel's running counts. The figures
 * still flicker, but a figure only changes when the fact behind it does —
 * the clock cells tick, a pull's series count climbs, a latency figure lands
 * with each command. Flicker is truth here, not theater.
 *
 * Everything is a read-only projection of what the wire already carries;
 * the cascade issues no commands and adds no traffic.
 *
 * @module
 */
import type { PromptContext } from '@fnndsc/menu';
import type { ProgressMessage } from '../calypso/client.js';

/** One cascade cell: an element and the digit width it renders. */
interface CascadeCell {
  element: HTMLDivElement;
  width: number;
  source: () => number;
}

/** One labeled telemetry row: the value element and its text source. */
interface TelemetryRow {
  element: HTMLElement;
  source: () => string;
}

/** The column widths of the cascade grid, per the prototype's proportions. */
const COLUMN_WIDTHS: readonly number[] = [2, 3, 3, 2, 2, 11, 2, 2];

/** Rows per cascade column, per the prototype. */
const ROW_COUNT: number = 4;

/** How often the cascade repaints, in milliseconds. */
const BEAT_MS: number = 300;

/** How often one column sweeps bright, in milliseconds. */
const SWEEP_MS: number = 2600;

/** How long a sweep lasts, in milliseconds. */
const SWEEP_HOLD_MS: number = 650;

/**
 * The live telemetry the cascade projects. Observers keep it current; the
 * beat loop reads it. All values are numbers because the cascade renders
 * zero-padded figures, per the LCARS idiom.
 */
interface Telemetry {
  jobsLoaded: number;
  jobsTotal: number;
  lastLatencyMs: number;
  latencySumMs: number;
  lastExitCode: number;
  commandsRun: number;
  opsActive: number;
  opsDone: number;
  opsFailed: number;
  itemsCurrent: number;
  itemsTotal: number;
  connected: number;
}

/**
 * The data cascade: binds every cell in the LCARS number field to a live
 * telemetry source and repaints on a steady beat.
 */
export class Cascade {
  private readonly wrapper: HTMLElement;
  private readonly cells: CascadeCell[] = [];
  private readonly bootedAt: number = Date.now();
  private readonly telemetry: Telemetry = {
    jobsLoaded: 0,
    jobsTotal: 0,
    lastLatencyMs: 0,
    latencySumMs: 0,
    lastExitCode: 0,
    commandsRun: 0,
    opsActive: 0,
    opsDone: 0,
    opsFailed: 0,
    itemsCurrent: 0,
    itemsTotal: 0,
    connected: 0,
  };
  private readonly activeOperations: Set<string> = new Set<string>();
  private readonly telemetryRows: TelemetryRow[] = [];

  /**
   * Builds the cascade grid inside the wrapper and starts the beat and
   * sweep loops.
   *
   * @param wrapper - The `#data-cascade` element to populate.
   */
  constructor(wrapper: HTMLElement) {
    this.wrapper = wrapper;
    const narrowSources: Array<() => number> = this.narrowSources_list();
    const wideSources: Array<() => number> = this.wideSources_list();
    let narrowIndex: number = 0;
    let wideIndex: number = 0;
    for (const width of COLUMN_WIDTHS) {
      const column: HTMLDivElement = document.createElement('div');
      column.className = 'data-column';
      for (let rowIndex: number = 1; rowIndex <= ROW_COUNT; rowIndex++) {
        const row: HTMLDivElement = document.createElement('div');
        row.className = `dc-row-${rowIndex}`;
        let source: (() => number) | undefined;
        if (width >= 6) {
          source = wideSources[wideIndex % wideSources.length];
          wideIndex++;
        } else {
          source = narrowSources[narrowIndex % narrowSources.length];
          narrowIndex++;
        }
        const cell: CascadeCell = {
          element: row,
          width,
          source: source ?? ((): number => 0),
        };
        row.textContent = figure_format(cell.source(), width);
        column.appendChild(row);
        this.cells.push(cell);
      }
      wrapper.appendChild(column);
    }
    window.setInterval((): void => this.beat_paint(), BEAT_MS);
    this.sweep_start();
  }

  /**
   * Folds a prompt context into the telemetry: warm-up counts, latency,
   * exit code.
   *
   * @param context - The daemon's prompt context.
   */
  public promptContext_observe(context: PromptContext): void {
    const warmup = context.procWarmup;
    if (warmup !== undefined) {
      this.telemetry.jobsLoaded = warmup.loaded;
      this.telemetry.jobsTotal = warmup.total ?? warmup.loaded;
    }
    if (context.lastCommandDurationMs > 0) {
      this.telemetry.lastLatencyMs = context.lastCommandDurationMs;
      this.telemetry.latencySumMs += context.lastCommandDurationMs;
      this.telemetry.commandsRun++;
    }
    this.telemetry.lastExitCode = context.lastExitCode;
  }

  /**
   * Folds a typed progress message into the telemetry: running, completed,
   * and failed operation counts, plus the latest counted item figures.
   *
   * @param message - A message from the typed progress channel.
   */
  public progress_observe(message: ProgressMessage): void {
    const key: string = `${message.operation}:${message.itemId ?? ''}`;
    if (message.phase === 'complete') {
      this.activeOperations.delete(key);
      if (message.status === 'error') {
        this.telemetry.opsFailed++;
      } else {
        this.telemetry.opsDone++;
      }
    } else {
      this.activeOperations.add(key);
    }
    this.telemetry.opsActive = this.activeOperations.size;
    if (message.current !== undefined) {
      this.telemetry.itemsCurrent = message.current;
    }
    if (message.total !== undefined) {
      this.telemetry.itemsTotal = message.total;
    }
  }

  /**
   * Records the connection state; a lost link dims the whole cascade.
   *
   * @param connected - True while the daemon link is up.
   */
  public connection_show(connected: boolean): void {
    this.telemetry.connected = connected ? 1 : 0;
    this.wrapper.classList.toggle('dc-stale', !connected);
  }

  /**
   * Builds the labeled telemetry face: the same figures the cascade renders
   * as bare numbers, each against its name. The beat loop keeps it current
   * whether or not it is visible, so revealing it costs nothing.
   *
   * @param container - The element to render the labeled rows into.
   */
  public telemetryPanel_bind(container: HTMLElement): void {
    const t: Telemetry = this.telemetry;
    const rows: Array<[string, () => string]> = [
      ['LINK', (): string => (t.connected === 1 ? 'ONLINE' : 'OFFLINE')],
      ['JOBS INDEXED', (): string => `${t.jobsLoaded} / ${t.jobsTotal}`],
      ['OPS ACTIVE', (): string => String(t.opsActive)],
      ['OPS DONE', (): string => String(t.opsDone)],
      ['OPS FAILED', (): string => String(t.opsFailed)],
      ['ITEMS', (): string => `${t.itemsCurrent} / ${t.itemsTotal}`],
      ['LAST COMMAND', (): string => `${t.lastLatencyMs} MS`],
      ['LATENCY SUM', (): string => `${t.latencySumMs} MS`],
      ['COMMANDS RUN', (): string => String(t.commandsRun)],
      ['LAST EXIT', (): string => String(t.lastExitCode)],
      ['UPTIME', (): string => `${this.uptimeSeconds_get()} S`],
    ];
    for (const [label, source] of rows) {
      const row: HTMLDivElement = document.createElement('div');
      row.className = 'telemetry-row';
      const name: HTMLSpanElement = document.createElement('span');
      name.className = 'telemetry-label';
      name.textContent = label;
      const value: HTMLSpanElement = document.createElement('span');
      value.className = 'telemetry-value';
      value.textContent = source();
      row.append(name, value);
      container.appendChild(row);
      this.telemetryRows.push({ element: value, source });
    }
  }

  /** Sources for the narrow (2-3 digit) cells, cycled across the grid. */
  private narrowSources_list(): Array<() => number> {
    const t: Telemetry = this.telemetry;
    return [
      (): number => t.jobsLoaded,
      (): number => t.lastLatencyMs,
      (): number => t.opsActive,
      (): number => t.opsDone,
      (): number => t.jobsTotal,
      (): number => t.itemsCurrent,
      (): number => t.itemsTotal,
      (): number => t.opsFailed,
      (): number => t.commandsRun,
      (): number => t.lastExitCode,
      (): number => new Date().getSeconds(),
      (): number => this.uptimeSeconds_get(),
    ];
  }

  /** Sources for the wide (6+ digit) cells: the clock and the long sums. */
  private wideSources_list(): Array<() => number> {
    return [
      (): number => Math.floor(Date.now() / 1000),
      (): number => this.uptimeSeconds_get(),
      (): number => this.telemetry.latencySumMs,
      (): number => clock_figure(),
    ];
  }

  /** @returns Whole seconds since the page booted. */
  private uptimeSeconds_get(): number {
    return Math.floor((Date.now() - this.bootedAt) / 1000);
  }

  /** Repaints every cell and row whose backing figure changed since last beat. */
  private beat_paint(): void {
    for (const cell of this.cells) {
      const figure: string = figure_format(cell.source(), cell.width);
      if (cell.element.textContent !== figure) {
        cell.element.textContent = figure;
      }
    }
    for (const row of this.telemetryRows) {
      const value: string = row.source();
      if (row.element.textContent !== value) {
        row.element.textContent = value;
      }
    }
  }

  /** Starts the bright sweep: every few seconds one column flares. */
  private sweep_start(): void {
    const columns: HTMLDivElement[] = Array.from(
      this.wrapper.querySelectorAll('.data-column'),
    );
    window.setInterval((): void => {
      const column = columns[Math.floor(Math.random() * columns.length)];
      if (column !== undefined) {
        column.classList.add('dc-sweep');
        window.setTimeout((): void => column.classList.remove('dc-sweep'), SWEEP_HOLD_MS);
      }
    }, SWEEP_MS);
  }
}

/**
 * Renders a telemetry value as a zero-padded cascade figure. Values wider
 * than the cell keep their trailing digits — the moving end of a counter.
 *
 * @param value - The telemetry value.
 * @param width - The cell's digit width.
 * @returns The figure as text.
 */
function figure_format(value: number, width: number): string {
  const digits: string = String(Math.max(0, Math.floor(value)));
  return digits.length > width
    ? digits.slice(digits.length - width)
    : digits.padStart(width, '0');
}

/** @returns The wall clock as an HHMMSS figure. */
function clock_figure(): number {
  const now: Date = new Date();
  return now.getHours() * 10000 + now.getMinutes() * 100 + now.getSeconds();
}
