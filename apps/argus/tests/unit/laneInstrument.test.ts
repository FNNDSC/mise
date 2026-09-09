/**
 * @jest-environment jsdom
 */
/**
 * @file Unit tests for the LANE, BEAT and CUBE rows.
 */

import { describe, it, expect } from '@jest/globals';
import { LaneInstrument, BEAT_LATE_MS } from '../../src/app/laneInstrument.js';

function mount_make(): HTMLElement {
  const mount: HTMLElement = document.createElement('div');
  document.body.appendChild(mount);
  return mount;
}

function rows_text(mount: HTMLElement): string[] {
  return Array.from(mount.querySelectorAll('.lane-row')).map((row: Element): string => row.textContent ?? '');
}

describe('LaneInstrument', () => {
  it('before any heartbeat: no lane, no beat, no pace', () => {
    const mount: HTMLElement = mount_make();
    new LaneInstrument(mount, (): number => 0);
    expect(rows_text(mount)).toEqual(['LANE—', 'BEATNONE YET', 'CUBENO PAGE TIMED']);
  });

  it('an idle lane, a fresh beat, and CUBE\'s pace as seconds per page and pages per minute', () => {
    const mount: HTMLElement = mount_make();
    let now: number = 1000;
    const instrument: LaneInstrument = new LaneInstrument(mount, (): number => now);
    instrument.telemetry_show({ lane: { running: null, waiting: 0 }, cube: { msPerPage: 2800, samples: 20 } });
    expect(rows_text(mount)).toEqual(['LANEIDLE', 'BEAT0.0 S AGO', 'CUBE2.8 S/PAGE · 21 PAGES/MIN']);
    now = 1000 + 1400;
    instrument.tick();
    expect(rows_text(mount)[1]).toBe('BEAT1.4 S AGO');
    expect(mount.querySelectorAll('.lane-row')[1]?.classList.contains('status-degraded')).toBe(false);
  });

  it('a held lane names the command, its age and the queue behind it; ten seconds turns it red', () => {
    const mount: HTMLElement = mount_make();
    const instrument: LaneInstrument = new LaneInstrument(mount, (): number => 0);
    instrument.telemetry_show({ lane: { running: { line: 'pacs query AccessionNumber:1', sinceMs: 9600, surface: 'c983aa' }, waiting: 2 } });
    expect(rows_text(mount)[0]).toBe('LANEpacs query AccessionNumber:1 · 9.6 S · 2 WAITING');
    expect(mount.querySelector('.lane-row')?.classList.contains('status-degraded')).toBe(false);
    instrument.telemetry_show({ lane: { running: { line: 'pacs query AccessionNumber:1', sinceMs: 12_000, surface: 'c983aa' }, waiting: 0 } });
    expect(rows_text(mount)[0]).toBe('LANEpacs query AccessionNumber:1 · 12.0 S');
    expect(mount.querySelector('.lane-row')?.classList.contains('status-degraded')).toBe(true);
  });

  it('a late beat is the daemon\'s health lamp: red past three seconds', () => {
    const mount: HTMLElement = mount_make();
    let now: number = 0;
    const instrument: LaneInstrument = new LaneInstrument(mount, (): number => now);
    instrument.telemetry_show({});
    now = BEAT_LATE_MS;
    instrument.tick();
    expect(rows_text(mount)[1]).toBe('BEAT3.0 S AGO');
    expect(mount.querySelectorAll('.lane-row')[1]?.classList.contains('status-degraded')).toBe(true);
  });
});
