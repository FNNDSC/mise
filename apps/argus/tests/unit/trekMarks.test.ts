/**
 * @jest-environment jsdom
 */
/**
 * @file The marks: one symbol per kind, the four Klingon marks handed out by
 * identity and carried by the engine's lines, and the shield ring read from
 * the state.
 */
import { describe, it, expect } from '@jest/globals';
import {
  KLINGON_MARKS, KlingonTracker, LEGEND, MARK_GLYPHS, mark_use, markDefs_make, markIcon_make, shieldRing_of, symbolId_of, symbolNames_list,
} from '../../src/features/trek/marks.js';

describe('the symbol table', () => {
  it('holds one symbol per kind and one per Klingon mark, and the legend names every kind with the C\'s glyph', () => {
    const names: ReadonlyArray<string> = symbolNames_list();
    for (const kind of ['ship', 'base', 'inhabited', 'star', 'hole', 'supernova']) expect(names).toContain(kind);
    for (const mark of KLINGON_MARKS) expect(names).toContain(`klingon-${mark}`);
    expect(LEGEND.map((row): string => row.kind)).toEqual(['ship', 'klingon', 'base', 'inhabited', 'star', 'hole', 'supernova']);
    expect(MARK_GLYPHS.klingon).toBe('K');
    expect(MARK_GLYPHS.supernova).toBe('///');
  });

  it('a mark refers to its symbol; a Klingon without a mark wears the first; the defs are built once per document', () => {
    expect(symbolId_of('ship')).toBe('tm-ship');
    expect(symbolId_of('klingon', 'talon')).toBe('tm-klingon-talon');
    expect(symbolId_of('klingon', null)).toBe('tm-klingon-cruiser');
    expect(symbolId_of('klingon', 'not-a-mark')).toBe('tm-klingon-cruiser');
    const use: SVGElement = mark_use('base', { x: 1, y: 2, size: 0.7 });
    expect(use.getAttribute('href')).toBe('#tm-base');
    expect(use.getAttribute('width')).toBe('0.7');
    const icon: SVGElement = markIcon_make('klingon', 'raptor');
    expect(icon.classList.contains('tm-icon-klingon')).toBe(true);
    expect(icon.querySelector('use')?.getAttribute('href')).toBe('#tm-klingon-raptor');
    const defs: SVGElement | null = markDefs_make();
    expect(defs).not.toBeNull();
    document.body.append(defs as SVGElement);
    expect(document.querySelectorAll('symbol')).toHaveLength(symbolNames_list().length);
    expect(markDefs_make()).toBeNull();
    (defs as SVGElement).remove();
  });
});

describe('the Klingon tracker', () => {
  it('hands a newcomer the least-worn mark, carries a mark along a `moves to` line, frees it on a kill or an escape', () => {
    const tracker: KlingonTracker = new KlingonTracker();
    tracker.reconcile([{ x: 0, y: 2 }, { x: 5, y: 3 }]);
    expect(tracker.mark_of({ x: 0, y: 2 })).toBe('cruiser');
    expect(tracker.mark_of({ x: 5, y: 3 })).toBe('raptor');
    expect(tracker.line_hear('Klingon at 0,2 moves to 6,2')).toBe(true);
    expect(tracker.mark_of({ x: 0, y: 2 })).toBeNull();
    expect(tracker.mark_of({ x: 6, y: 2 })).toBe('cruiser');
    // the state agrees: nothing changes
    tracker.reconcile([{ x: 6, y: 2 }, { x: 5, y: 3 }]);
    expect(tracker.mark_of({ x: 6, y: 2 })).toBe('cruiser');
    expect(tracker.line_hear('   *** Klingon at 6,2 destroyed ***')).toBe(true);
    expect(tracker.mark_of({ x: 6, y: 2 })).toBeNull();
    // a newcomer takes the freed mark, not a third
    tracker.reconcile([{ x: 5, y: 3 }, { x: 1, y: 1 }]);
    expect(tracker.mark_of({ x: 1, y: 1 })).toBe('cruiser');
    expect(tracker.line_hear('Klingon at 5,3 escapes to quadrant 6,6')).toBe(true);
    expect(tracker.mark_of({ x: 5, y: 3 })).toBeNull();
    expect(tracker.line_hear('Stardate 3900.00: Klingon attack:')).toBe(false);
  });

  it('a fifth Klingon wears a mark again; a new quadrant forgets everything; with the sensors down the marks follow list order', () => {
    const tracker: KlingonTracker = new KlingonTracker();
    const five = [0, 1, 2, 3, 4].map((i: number) => ({ x: i, y: 9 }));
    tracker.reconcile(five);
    expect(five.map((k) => tracker.mark_of(k))).toEqual(['cruiser', 'raptor', 'talon', 'warbird', 'cruiser']);
    tracker.reconcile([{ x: 7, y: 7 }], { reset: true });
    expect(tracker.mark_of({ x: 0, y: 9 })).toBeNull();
    expect(tracker.mark_of({ x: 7, y: 7 })).toBe('cruiser');
    tracker.reconcile([{ x: 2, y: 2 }, { x: 7, y: 7 }], { byOrder: true });
    expect(tracker.mark_of({ x: 2, y: 2 })).toBe('cruiser');
    expect(tracker.mark_of({ x: 7, y: 7 })).toBe('raptor');
  });
});

describe('the shield ring', () => {
  it('is thick and cool when full, warmer and thinner as it drains, thin and dashed when down, the starbase\'s when docked', () => {
    const full = shieldRing_of(1500, 1500, true, false);
    expect(full.className).toBe('tb-ring tb-ring-full');
    expect(full.width).toBeCloseTo(0.11, 5);
    expect(full.percent).toBe(100);
    expect(shieldRing_of(750, 1500, true, false).className).toBe('tb-ring tb-ring-mid');
    const low = shieldRing_of(150, 1500, true, false);
    expect(low.className).toBe('tb-ring tb-ring-low');
    expect(low.width).toBeLessThan(full.width);
    const down = shieldRing_of(1500, 1500, false, false);
    expect(down.className).toBe('tb-ring tb-ring-down');
    expect(down.width).toBe(0.02);
    expect(shieldRing_of(100, 1500, false, true).className).toBe('tb-ring tb-ring-docked');
    expect(shieldRing_of(-5, 0, true, false).percent).toBe(0);
  });
});
