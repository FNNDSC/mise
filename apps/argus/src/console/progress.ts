/**
 * @file Live progress rendering for the argus console.
 *
 * The daemon reports what is happening — an operation, a phase, a label, and
 * where they are known, counts. It does not report how to draw it. This is
 * argus's answer to that report, and it is deliberately not a terminal's:
 * indeterminate work spins with CSS, counted work fills a bar, and neither
 * needs a carriage return.
 *
 * Rows live in a region of their own between the transcript and the prompt,
 * updated in place and removed when their work ends. Nothing about a running
 * operation is written into the transcript, because the transcript is the
 * record of what happened and a spinner is not a thing that happened. A
 * failure is: it commits a line and stays.
 *
 * @module
 */

import type { ProgressMessage } from '../calypso/client.js';

/** How often elapsed counters are repainted, in milliseconds. */
const ELAPSED_TICK_MS: number = 100;

/** Progress events carrying no total render as indeterminate. */
interface ProgressRow {
  element: HTMLElement;
  labelElement: HTMLElement;
  barFill: HTMLElement | null;
  startedAt: number;
}

/**
 * Escapes text for interpolation into row markup.
 *
 * @param text - Raw text from the daemon.
 * @returns The text with HTML metacharacters neutralised.
 */
function text_escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Formats a byte count for display, leaving other units as plain integers.
 *
 * @param value - The counter value.
 * @param unit - The unit the counter is expressed in.
 * @returns A short human-readable rendering.
 */
function counter_format(value: number, unit: string | undefined): string {
  if (unit !== 'bytes') {
    return String(value);
  }
  const units: string[] = ['B', 'KB', 'MB', 'GB', 'TB'];
  let scaled: number = value;
  let index: number = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${index === 0 ? scaled : scaled.toFixed(1)}${units[index]}`;
}

/**
 * Renders structured progress events into a live region.
 *
 * One row per concurrent operation, keyed by operation and item, so a pull
 * reporting many series shows many rows while a scan shows one.
 */
export class ArgusProgress {
  private readonly region: HTMLElement;
  private readonly line_commit: (text: string) => void;
  private readonly rows: Map<string, ProgressRow> = new Map<string, ProgressRow>();
  private elapsedTimer: number | null = null;

  /**
   * @param region - The element rows are rendered into.
   * @param line_commit - Writes one line into the transcript, used for
   *   failures, which belong to the record rather than to the live region.
   */
  constructor(region: HTMLElement, line_commit: (text: string) => void) {
    this.region = region;
    this.line_commit = line_commit;
  }

  /**
   * Renders one progress event.
   *
   * @param message - The event as it arrived from the daemon.
   */
  public write(message: ProgressMessage): void {
    const key: string = `${message.operation}:${message.itemId ?? ''}`;

    if (message.phase === 'complete' || message.phase === 'failed') {
      if (message.phase === 'failed') {
        const label: string = message.label ?? message.operation;
        this.line_commit(`\x1b[31m${label} — failed\x1b[0m\n`);
      }
      this.row_remove(key);
      return;
    }

    const row: ProgressRow = this.rows.get(key) ?? this.row_create(key, message);
    this.row_paint(row, message);
    this.elapsed_ensure();
  }

  /**
   * Removes every row, ending any work the region still claims is running.
   *
   * Progress describes a running command, so nothing may outlive one. A
   * builtin that fails between announcing work and closing it would otherwise
   * leave a row spinning against nothing.
   */
  public clear(): void {
    for (const key of [...this.rows.keys()]) {
      this.row_remove(key);
    }
  }

  /**
   * Builds a row and inserts it into the region.
   *
   * @param key - The row's identity within the region.
   * @param message - The event the row is created from.
   * @returns The created row.
   */
  private row_create(key: string, message: ProgressMessage): ProgressRow {
    const determinate: boolean = message.total !== undefined && message.total > 0;
    const element: HTMLElement = document.createElement('div');
    element.className = 'argus-progress-row';
    element.innerHTML = determinate
      ? `<span class="argus-progress-label"></span>
         <span class="argus-progress-bar"><span class="argus-progress-fill"></span></span>
         <span class="argus-progress-elapsed"></span>`
      : `<span class="argus-progress-spin" aria-hidden="true"></span>
         <span class="argus-progress-label"></span>
         <span class="argus-progress-elapsed"></span>`;
    this.region.appendChild(element);
    const row: ProgressRow = {
      element,
      labelElement: element.querySelector('.argus-progress-label') as HTMLElement,
      barFill: element.querySelector('.argus-progress-fill'),
      startedAt: performance.now(),
    };
    this.rows.set(key, row);
    return row;
  }

  /**
   * Updates a row's label, counts and bar from an event.
   *
   * @param row - The row to repaint.
   * @param message - The event carrying the new state.
   */
  private row_paint(row: ProgressRow, message: ProgressMessage): void {
    const label: string = message.label ?? message.operation;
    const counts: string =
      message.current !== undefined && message.total !== undefined && message.total > 0
        ? ` ${counter_format(message.current, message.unit)}/${counter_format(message.total, message.unit)}`
        : '';
    row.labelElement.innerHTML = `${text_escape(label)}<span class="argus-progress-counts">${text_escape(counts)}</span>`;

    if (row.barFill !== null) {
      const percent: number =
        message.percent ??
        (message.current !== undefined && message.total !== undefined && message.total > 0
          ? (message.current / message.total) * 100
          : 0);
      row.barFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
  }

  /**
   * Removes one row and stops the elapsed timer once none remain.
   *
   * @param key - The row's identity within the region.
   */
  private row_remove(key: string): void {
    const row: ProgressRow | undefined = this.rows.get(key);
    if (row === undefined) {
      return;
    }
    row.element.remove();
    this.rows.delete(key);
    if (this.rows.size === 0 && this.elapsedTimer !== null) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  /** Starts the shared elapsed-counter repaint, if it is not already running. */
  private elapsed_ensure(): void {
    if (this.elapsedTimer !== null) {
      return;
    }
    this.elapsed_paint();
    this.elapsedTimer = window.setInterval((): void => this.elapsed_paint(), ELAPSED_TICK_MS);
  }

  /**
   * Repaints every row's elapsed counter.
   *
   * The daemon reports that work is under way; how long it has been under way
   * is measured here, so a wait of any length costs no extra wire traffic.
   */
  private elapsed_paint(): void {
    const now: number = performance.now();
    for (const row of this.rows.values()) {
      const elapsed: HTMLElement | null = row.element.querySelector('.argus-progress-elapsed');
      if (elapsed !== null) {
        elapsed.textContent = `${((now - row.startedAt) / 1000).toFixed(1)}s`;
      }
    }
  }
}
