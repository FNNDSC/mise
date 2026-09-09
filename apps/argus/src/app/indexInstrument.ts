/**
 * @file The INDEX instrument: index movement, on the header's resting face.
 *
 * Index movement no command announces — the global sweep, one feed's
 * first-visit walk, roster arrivals — is annunciated on the prompt and on
 * the status line as text. This instrument is where it is READ: a
 * permanent row on the resting face that says the index is current when
 * nothing moves (a quiet daemon says so; a blank would be a lie), and one
 * row per movement with a bar while something does. Same prompt context as
 * the status line, one source drawn twice; the bars wear the state hues
 * the listing façade already defines, never a raw colour.
 *
 * @module
 */

import type { PromptContext } from '@fnndsc/menu';

/** The steady-state counts the daemon's telemetry heartbeat carries. */
export interface IndexCounts {
  jobs: number;
  feeds: number;
}

/** One movement the instrument shows: what it is, how far, and how it went. */
interface IndexRow {
  label: string;
  bar: { loaded: number; total: number; state: 'running' | 'done' | 'failed' } | null;
  value: string;
  title: string;
  degraded: boolean;
}

/** A count for a readout: thin-space groups, as the listing shows sizes. */
function count_format(n: number): string {
  return n.toLocaleString('en-US');
}

/** The header instrument for index movement. */
export class IndexInstrument {
  private readonly mount: HTMLElement;
  private counts: IndexCounts | null = null;
  private context: PromptContext | null = null;

  /**
   * @param mount - The element the rows are drawn into (`#index-instrument`).
   */
  constructor(mount: HTMLElement) {
    this.mount = mount;
    this.render();
  }

  /**
   * The daemon's steady counts, from the telemetry heartbeat.
   *
   * @param counts - Jobs and feeds the index holds.
   */
  public counts_show(counts: IndexCounts): void {
    this.counts = counts;
    this.render();
  }

  /**
   * The prompt context: the movement in flight, if any, rides here.
   *
   * @param context - The engine-known prompt facts.
   */
  public promptContext_show(context: PromptContext): void {
    this.context = context;
    if (context.procIndex !== undefined) this.counts = { jobs: context.procIndex.jobs, feeds: context.procIndex.feeds };
    this.render();
  }

  /**
   * The rows the current facts call for: the INDEX row always, then one
   * per movement in flight.
   *
   * @returns The rows, in reading order.
   */
  public rows_compose(): IndexRow[] {
    const rows: IndexRow[] = [];
    const warmup = this.context?.procWarmup;
    const failures = this.context?.warmupFailures ?? [];
    const sweeping: boolean = warmup !== undefined && warmup.sweeping !== false;

    // The index row: what the index holds and whether anything ails it.
    const holds: string = this.counts !== null
      ? `${count_format(this.counts.jobs)} JOBS · ${count_format(this.counts.feeds)} FEEDS`
      : '';
    if (failures.length > 0) {
      rows.push({
        label: 'INDEX',
        bar: null,
        value: `${holds}${holds ? ' · ' : ''}FAILED: ${failures.map((f) => f.label.toUpperCase()).join(' ')}`,
        title: failures.map((f) => `${f.label}: ${f.message}`).join('\n'),
        degraded: true,
      });
    } else if (sweeping && warmup !== undefined) {
      const state: string = (warmup.state ?? 'cold').toUpperCase();
      rows.push({
        label: 'INDEX',
        bar: {
          loaded: warmup.loaded,
          total: warmup.total ?? 0,
          state: warmup.state === 'failed' ? 'failed' : 'running',
        },
        value: `SWEEP ${count_format(warmup.loaded)} / ${warmup.total !== undefined ? count_format(warmup.total) : '?'} · ${state}`,
        title: 'The global topology sweep: every plugin instance CUBE holds, walked page by page.',
        degraded: warmup.state === 'failed',
      });
    } else {
      rows.push({
        label: 'INDEX',
        bar: null,
        value: holds ? `${holds} · CURRENT` : 'CURRENT',
        title: 'Nothing is moving: the process index is whole and current.',
        degraded: false,
      });
    }

    // Every feed's topology walk in flight, earliest first, and the walks
    // that stopped while their failure is remembered.
    const walks = warmup?.feeds ?? (warmup?.feed !== undefined ? [warmup.feed] : []);
    for (const feed of walks) {
      const total: string = feed.total > 0 ? count_format(feed.total) : '?';
      if (feed.failed !== undefined) {
        rows.push({
          label: `FEED ${feed.id}`,
          bar: { loaded: feed.loaded, total: feed.total, state: 'failed' },
          value: `FAILED AT ${count_format(feed.loaded)} / ${total} · ${feed.failed.toUpperCase()}`,
          title: 'The walk stopped; the next visit to the feed starts it again.',
          degraded: true,
        });
      } else {
        rows.push({
          label: `FEED ${feed.id}`,
          bar: { loaded: feed.loaded, total: feed.total, state: 'running' },
          value: `INDEXING ${count_format(feed.loaded)} / ${total}`,
          title: 'A feed is being indexed on its first visit; it opens when the walk lands.',
          degraded: false,
        });
      }
    }

    // Roster arrivals: feeds the index gained in the last half minute.
    const arrived: number[] = warmup?.arrived ?? [];
    if (arrived.length > 0) {
      rows.push({
        label: 'ARRIVED',
        bar: null,
        value: arrived.length <= 3 ? arrived.map((id: number): string => `FEED ${id}`).join(' · ') : `${arrived.length} FEEDS`,
        title: 'Feeds the roster gained: created here, or shared with this identity.',
        degraded: false,
      });
    }
    return rows;
  }

  /** Draws the rows. */
  private render(): void {
    const rows: IndexRow[] = this.rows_compose();
    this.mount.replaceChildren();
    for (const row of rows) {
      const line: HTMLDivElement = document.createElement('div');
      line.className = 'index-row telemetry-row';
      line.classList.toggle('status-degraded', row.degraded);
      line.title = row.title;
      const label: HTMLSpanElement = document.createElement('span');
      label.className = 'telemetry-label';
      label.textContent = row.label;
      line.appendChild(label);
      if (row.bar !== null) {
        const track: HTMLSpanElement = document.createElement('span');
        track.className = `index-bar listing-progress listing-progress-${row.bar.state}`;
        const fill: HTMLSpanElement = document.createElement('span');
        fill.className = 'listing-progress-fill';
        const percent: number = row.bar.total > 0 ? Math.min(100, Math.round((row.bar.loaded / row.bar.total) * 100)) : 0;
        fill.style.width = `${percent}%`;
        track.appendChild(fill);
        line.appendChild(track);
      }
      const value: HTMLSpanElement = document.createElement('span');
      value.className = 'telemetry-value';
      value.textContent = row.value;
      line.appendChild(value);
      this.mount.appendChild(line);
    }
  }
}
