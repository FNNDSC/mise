/**
 * @file The LANE, BEAT and CUBE rows: the session's plumbing, on the
 * ARGUS WEB face.
 *
 * LANE is the serialized command queue as a gauge: idle, or the line
 * holding it, for how long, and how many wait behind it. The stall that
 * opened epic #495 was a minute on this lane that nothing showed. BEAT is
 * the age of the last telemetry heartbeat: the daemon's health lamp, red
 * past three seconds, since a daemon that stops beating is one whose
 * readouts all lie. CUBE is the pace CUBE serves pages at, the number
 * that turns a walk's page count into minutes.
 *
 * @module
 */

import type { LaneTelemetry, CubeTelemetry } from '@fnndsc/menu';

/** Past this age the beat is late and the row turns red. */
export const BEAT_LATE_MS: number = 3000;

/** One row of the instrument. */
interface LaneRow {
  label: string;
  value: string;
  title: string;
  degraded: boolean;
}

/** The lane, beat and pace rows. */
export class LaneInstrument {
  private readonly mount: HTMLElement;
  private readonly clock: () => number;
  private lane: LaneTelemetry | undefined = undefined;
  private cube: CubeTelemetry | undefined = undefined;
  private beatAt: number | null = null;

  /**
   * @param mount - The element the rows are drawn into (`#lane-instrument`).
   * @param clock - The clock the beat's age is measured against (default `Date.now`).
   */
  constructor(mount: HTMLElement, clock: () => number = (): number => Date.now()) {
    this.mount = mount;
    this.clock = clock;
    this.render();
  }

  /**
   * A telemetry heartbeat landed.
   *
   * @param extra - The lane and the pace it carried, when the daemon sends them.
   */
  public telemetry_show(extra: { lane?: LaneTelemetry; cube?: CubeTelemetry } = {}): void {
    this.beatAt = this.clock();
    if (extra.lane !== undefined) this.lane = extra.lane;
    if (extra.cube !== undefined) this.cube = extra.cube;
    this.render();
  }

  /** Repaints the beat's age; called on the surface's own tick. */
  public tick(): void {
    this.render();
  }

  /**
   * The rows the current facts call for.
   *
   * @returns LANE, BEAT, CUBE, in that order.
   */
  public rows_compose(): LaneRow[] {
    const rows: LaneRow[] = [];

    const lane = this.lane;
    if (lane === undefined) {
      rows.push({ label: 'LANE', value: '—', title: 'The daemon has not said what holds its lane (an older daemon).', degraded: false });
    } else if (lane.running === null) {
      rows.push({
        label: 'LANE',
        value: lane.waiting > 0 ? `IDLE · ${lane.waiting} WAITING` : 'IDLE',
        title: 'The serialized command lane: nothing is executing.',
        degraded: false,
      });
    } else {
      const seconds: string = (lane.running.sinceMs / 1000).toFixed(1);
      rows.push({
        label: 'LANE',
        value: `${lane.running.line} · ${seconds} S${lane.waiting > 0 ? ` · ${lane.waiting} WAITING` : ''}`,
        title: `The command holding the lane${lane.running.surface ? `, from surface ${lane.running.surface}` : ''}; every other command waits behind it.`,
        degraded: lane.running.sinceMs >= 10_000,
      });
    }

    if (this.beatAt === null) {
      rows.push({ label: 'BEAT', value: 'NONE YET', title: 'No telemetry heartbeat has landed.', degraded: false });
    } else {
      const age: number = Math.max(0, this.clock() - this.beatAt);
      rows.push({
        label: 'BEAT',
        value: `${(age / 1000).toFixed(1)} S AGO`,
        title: 'The age of the last telemetry heartbeat; the daemon beats once a second while a surface is attached.',
        degraded: age >= BEAT_LATE_MS,
      });
    }

    const cube = this.cube;
    if (cube === undefined) {
      rows.push({ label: 'CUBE', value: 'NO PAGE TIMED', title: 'CUBE\'s pace is known once a page of a list has been fetched.', degraded: false });
    } else {
      const perMin: number = cube.msPerPage > 0 ? Math.round(60_000 / cube.msPerPage) : 0;
      rows.push({
        label: 'CUBE',
        value: `${(cube.msPerPage / 1000).toFixed(1)} S/PAGE · ${perMin} PAGES/MIN`,
        title: `The median of the last ${cube.samples} page fetches (100 rows each).`,
        degraded: false,
      });
    }
    return rows;
  }

  /** Draws the rows. */
  private render(): void {
    const rows: LaneRow[] = this.rows_compose();
    this.mount.replaceChildren();
    for (const row of rows) {
      const line: HTMLDivElement = document.createElement('div');
      line.className = 'lane-row telemetry-row';
      line.classList.toggle('status-degraded', row.degraded);
      line.title = row.title;
      const label: HTMLSpanElement = document.createElement('span');
      label.className = 'telemetry-label';
      label.textContent = row.label;
      const value: HTMLSpanElement = document.createElement('span');
      value.className = 'telemetry-value';
      value.textContent = row.value;
      line.append(label, value);
      this.mount.appendChild(line);
    }
  }
}
