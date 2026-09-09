/**
 * @jest-environment jsdom
 */
/**
 * @file Unit tests for the header INDEX instrument.
 *
 * The instrument is the one place index movement is READ: it must say the
 * index is current when nothing moves, name each movement with a bar while
 * something does, keep a failure visible, and go back to CURRENT when the
 * movement clears. Composition is tested against the prompt context the
 * daemon pushes; geometry stays with the smoke suite.
 */

import { describe, it, expect } from '@jest/globals';
import type { PromptContext } from '@fnndsc/menu';
import { IndexInstrument } from '../../src/app/indexInstrument.js';

function context_make(over: Partial<PromptContext> = {}): PromptContext {
  return {
    user: 'chris', uri: 'http://cube/', cwd: '~', pacsserver: null,
    physicalMode: false, lastExitCode: 0, lastCommandDurationMs: 0,
    ...over,
  } as PromptContext;
}

function mount_make(): HTMLElement {
  const mount: HTMLElement = document.createElement('div');
  document.body.appendChild(mount);
  return mount;
}

function rows_text(mount: HTMLElement): string[] {
  return Array.from(mount.querySelectorAll('.index-row')).map((row: Element): string => row.textContent ?? '');
}

describe('IndexInstrument', () => {
  it('a quiet index says so: one row, CURRENT, with what the index holds', () => {
    const mount: HTMLElement = mount_make();
    const instrument: IndexInstrument = new IndexInstrument(mount);
    expect(rows_text(mount)).toEqual(['INDEXCURRENT']);
    instrument.counts_show({ jobs: 95989, feeds: 705 });
    expect(rows_text(mount)).toEqual(['INDEX95,989 JOBS · 705 FEEDS · CURRENT']);
    expect(mount.querySelector('.index-bar')).toBeNull();
  });

  it('a feed walk is a row with a bar that follows the count, and it clears when the walk lands', () => {
    const mount: HTMLElement = mount_make();
    const instrument: IndexInstrument = new IndexInstrument(mount);
    instrument.counts_show({ jobs: 95989, feeds: 705 });
    instrument.promptContext_show(context_make({
      procWarmup: { loaded: 95989, total: 95989, sweeping: false, feed: { id: 2384, loaded: 6500, total: 58760 } },
    }));
    expect(rows_text(mount)).toEqual([
      'INDEX95,989 JOBS · 705 FEEDS · CURRENT',
      'FEED 2384INDEXING 6,500 / 58,760',
    ]);
    const fill: HTMLElement = mount.querySelector('.index-bar .listing-progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('11%');
    expect(mount.querySelector('.index-bar')?.classList.contains('listing-progress-running')).toBe(true);

    instrument.promptContext_show(context_make({ procIndex: { jobs: 154749, feeds: 706 } }));
    expect(rows_text(mount)).toEqual(['INDEX154,749 JOBS · 706 FEEDS · CURRENT']);
  });

  it('a walk that stopped stays named where it stopped, degraded, until it is forgotten', () => {
    const mount: HTMLElement = mount_make();
    const instrument: IndexInstrument = new IndexInstrument(mount);
    instrument.promptContext_show(context_make({
      procWarmup: { loaded: 0, sweeping: false, feed: { id: 22, loaded: 100, total: 150, failed: 'CUBE 502' } },
    }));
    expect(rows_text(mount)).toEqual(['INDEXCURRENT', 'FEED 22FAILED AT 100 / 150 · CUBE 502']);
    const row: HTMLElement = mount.querySelectorAll('.index-row')[1] as HTMLElement;
    expect(row.classList.contains('status-degraded')).toBe(true);
    expect(mount.querySelector('.index-bar')?.classList.contains('listing-progress-failed')).toBe(true);
  });

  it('a walk row reads an ETA: from CUBE\'s pace before it moves, from its own rate once it has', () => {
    const mount: HTMLElement = mount_make();
    let now: number = 0;
    const instrument: IndexInstrument = new IndexInstrument(mount, (): number => now);
    instrument.pace_show(2800);
    instrument.promptContext_show(context_make({ procWarmup: { loaded: 0, sweeping: false, feed: { id: 2384, loaded: 600, total: 58760 } } }));
    // 58,160 rows left = 582 pages = 146 windows of four at 2.8 s: about 7 minutes.
    expect(rows_text(mount)[1]).toBe('FEED 2384INDEXING 600 / 58,760 · ETA 7 MIN');
    now = 10_000;
    instrument.promptContext_show(context_make({ procWarmup: { loaded: 0, sweeping: false, feed: { id: 2384, loaded: 1600, total: 58760 } } }));
    // 1,000 rows in 10 s: 57,160 left at 100 rows/s = 572 s, about 10 minutes.
    expect(rows_text(mount)[1]).toBe('FEED 2384INDEXING 1,600 / 58,760 · ETA 10 MIN');
    instrument.promptContext_show(context_make({}));
    expect(rows_text(mount)).toEqual(['INDEXCURRENT']);
  });

  it('two walks at once are two rows, earliest first', () => {
    const mount: HTMLElement = mount_make();
    const instrument: IndexInstrument = new IndexInstrument(mount);
    instrument.promptContext_show(context_make({
      procWarmup: {
        loaded: 0, sweeping: false,
        feed: { id: 2384, loaded: 47600, total: 58760 },
        feeds: [{ id: 2384, loaded: 47600, total: 58760 }, { id: 834, loaded: 300, total: 1323 }],
      },
    }));
    expect(rows_text(mount)).toEqual(['INDEXCURRENT', 'FEED 2384INDEXING 47,600 / 58,760', 'FEED 834INDEXING 300 / 1,323']);
  });

  it('the global sweep rides the INDEX row itself, with its state', () => {
    const mount: HTMLElement = mount_make();
    const instrument: IndexInstrument = new IndexInstrument(mount);
    instrument.promptContext_show(context_make({
      procWarmup: { loaded: 12400, total: 95591, state: 'cached', sweeping: true },
    }));
    expect(rows_text(mount)).toEqual(['INDEXSWEEP 12,400 / 95,591 · CACHED']);
    expect((mount.querySelector('.index-bar .listing-progress-fill') as HTMLElement).style.width).toBe('13%');
  });

  it('a failed warm-up step is the index row, degraded, with the steps named', () => {
    const mount: HTMLElement = mount_make();
    const instrument: IndexInstrument = new IndexInstrument(mount);
    instrument.counts_show({ jobs: 10, feeds: 2 });
    instrument.promptContext_show(context_make({ warmupFailures: [{ label: 'roster', message: 'connection lost' }] }));
    expect(rows_text(mount)).toEqual(['INDEX10 JOBS · 2 FEEDS · FAILED: ROSTER']);
    expect((mount.querySelector('.index-row') as HTMLElement).title).toBe('roster: connection lost');
  });

  it('the roster walk is a row of its own, full or delta', () => {
    const mount: HTMLElement = mount_make();
    const instrument: IndexInstrument = new IndexInstrument(mount);
    instrument.promptContext_show(context_make({ procWarmup: { loaded: 0, sweeping: false, roster: 'full' } }));
    expect(rows_text(mount)[1]).toBe('ROSTERFULL WALK · every feed the identity can see');
    instrument.promptContext_show(context_make({ procWarmup: { loaded: 0, sweeping: false, roster: 'delta' } }));
    expect(rows_text(mount)[1]).toBe('ROSTERDELTA · feeds newer than the roster knows');
    instrument.promptContext_show(context_make({}));
    expect(rows_text(mount)).toEqual(['INDEXCURRENT']);
  });

  it('arrivals are a row of their own, by name up to three', () => {
    const mount: HTMLElement = mount_make();
    const instrument: IndexInstrument = new IndexInstrument(mount);
    instrument.promptContext_show(context_make({ procWarmup: { loaded: 0, sweeping: false, arrived: [21, 22] } }));
    expect(rows_text(mount)[1]).toBe('ARRIVEDFEED 21 · FEED 22');
    instrument.promptContext_show(context_make({ procWarmup: { loaded: 0, sweeping: false, arrived: [1, 2, 3, 4] } }));
    expect(rows_text(mount)[1]).toBe('ARRIVED4 FEEDS');
  });
});
