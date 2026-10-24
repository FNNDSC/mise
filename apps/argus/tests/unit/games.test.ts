/**
 * @file The GAMES pane's own sizing; the programs it runs are tested in
 * menu (`tests/games.test.ts`).
 */
import { describe, it, expect } from '@jest/globals';
import { cell_compute } from '../../src/features/games/panel.js';

describe('the GAMES pane', () => {
  it('sizes the glyph cell to the field: about a hundred columns, never fewer rows than the arcade needs', () => {
    expect(cell_compute(2300, 1300)).toEqual({ w: 23, h: 41 });   // a zoomed pane: big glyphs
    expect(cell_compute(2300, 330).w).toBe(8);                    // a short pane: the rows win, at the floor
    expect(cell_compute(600, 400)).toEqual({ w: 8, h: 14 });      // a phone: the floor
    expect(cell_compute(5000, 3000).w).toBe(26);                  // a wall: the ceiling
  });
});
