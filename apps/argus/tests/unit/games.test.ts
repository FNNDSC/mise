/**
 * @file The arcade's rules and the showpieces' pictures, without a canvas:
 * a grid that records what was put where.
 */
import { describe, it, expect } from '@jest/globals';
import { TETROMINOES, WELL_COLS, WELL_ROWS, tetris_new, tetris_spawn, tetris_fall, tetris_lock, tetris_key, piece_fits, piece_rotated, snake_new, snake_step, snake_turn, tetris_make, snake_make } from '../../src/features/games/arcade.js';
import { sl_make, cmatrix_make, rain_make, aquarium_make } from '../../src/features/games/shows.js';
import { PROGRAMS, program_isName, cell_of } from '../../src/features/games/panel.js';
import type { Grid, Palette } from '../../src/features/games/program.js';

const PALETTE: Palette = { lit: 'lit', dim: 'dim', warn: 'warn', cool: 'cool' };

/** A grid that remembers every glyph put on it. */
function grid_record(cols: number, rows: number): Grid & { cells: Map<string, string> } {
  const cells: Map<string, string> = new Map();
  const put = (col: number, row: number, glyph: string, hue: string): void => {
    if (col < 0 || row < 0 || col >= cols || row >= rows) return;
    cells.set(`${col},${row}`, `${glyph}:${hue}`);
  };
  return { cols, rows, cells, put, text: (col, row, words, hue): void => { [...words].forEach((g: string, i: number): void => { if (g !== ' ') put(col + i, row, g, hue); }); } };
}

const zero = (): number => 0;

describe('tetris', () => {
  it('spawns, falls and locks; a full line clears and scores', () => {
    const state = tetris_new();
    tetris_spawn(state, zero);                     // the I piece, flat, at x=3
    expect(state.piece?.kind).toBe(1);
    expect(state.piece?.cells).toEqual(TETROMINOES[0]);
    for (let i: number = 0; i < WELL_ROWS + 2 && state.piece !== null; i++) tetris_fall(state, zero);
    expect(state.piece).toBeNull();
    expect(state.well[WELL_ROWS - 1]?.slice(3, 7)).toEqual([1, 1, 1, 1]);
    // A lock into a row that is not full clears nothing; one into the last gap clears the line.
    state.piece = { cells: [[0, 0]], x: 0, y: WELL_ROWS - 2, kind: 3 };
    tetris_lock(state);
    expect(state.lines).toBe(0);
    state.well[WELL_ROWS - 1] = Array(WELL_COLS).fill(0) as number[];
    state.well[WELL_ROWS - 1]!.fill(2, 0, WELL_COLS - 1);
    state.piece = { cells: [[0, 0]], x: WELL_COLS - 1, y: WELL_ROWS - 1, kind: 3 };
    tetris_lock(state);
    expect(state.lines).toBe(1);
    expect(state.score).toBe(100);
  });

  it('rotates in place and answers the keys', () => {
    const state = tetris_new();
    tetris_spawn(state, zero);
    const flat = state.piece!;
    const upright = piece_rotated(flat);
    expect(new Set(upright.cells.map(([x]: [number, number]): number => x)).size).toBe(1);
    expect(piece_fits(state.well, { ...flat, x: -1 })).toBe(false);
    expect(tetris_key(state, 'ArrowLeft', zero)).toBe(true);
    expect(state.piece?.x).toBe(2);
    expect(tetris_key(state, 'x', zero)).toBe(false);
    expect(tetris_key(state, ' ', zero)).toBe(true);
    expect(state.piece).toBeNull();                // dropped all the way and locked
  });

  it('is over when a new piece has no room; as a program it draws the well and reads the score', () => {
    const state = tetris_new();
    for (const row of state.well) row.fill(1);
    tetris_spawn(state, zero);
    expect(state.over).toBe(true);
    const program = tetris_make();
    program.step({ cols: 60, rows: 30 }, zero);
    const grid = grid_record(60, 30);
    program.draw(grid, PALETTE);
    expect([...grid.cells.values()].some((v: string): boolean => v.startsWith('|:'))).toBe(true);
    expect(program.status?.()).toMatch(/^0 · 0 lines/);
    expect(program.key?.('ArrowRight')).toBe(true);
  });
});

describe('snake', () => {
  it('moves, eats, grows, and dies on a wall or itself', () => {
    const state = snake_new(10, 6, () => 0.99);
    expect(state.body.length).toBe(3);
    state.food = [6, 3];                            // right in front of the head at (5,3)
    snake_step(state, () => 0.99);
    expect(state.body.length).toBe(4);
    expect(state.score).toBe(10);
    snake_turn(state, 'left');                      // a double-back is refused
    expect(state.next).toBe('right');
    snake_turn(state, 'up');
    snake_step(state, zero);
    expect(state.body[0]).toEqual([6, 2]);
    for (let i: number = 0; i < 5; i++) snake_step(state, zero);
    expect(state.over).toBe(true);
    const program = snake_make();
    program.step({ cols: 40, rows: 20 }, () => 0.5);
    expect(program.key?.('ArrowUp')).toBe(true);
    expect(program.key?.('q')).toBe(false);
    const grid = grid_record(40, 20);
    program.draw(grid, PALETTE);
    expect([...grid.cells.values()].filter((v: string): boolean => v === '@:lit').length).toBe(2);
  });
});

describe('the showpieces', () => {
  it('every program draws something after a few steps, and the table names them all', () => {
    for (const make of [sl_make, cmatrix_make, rain_make, aquarium_make]) {
      const program = make();
      let seed: number = 0.1;
      const random = (): number => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for (let i: number = 0; i < 40; i++) program.step({ cols: 60, rows: 20 }, random);
      const grid = grid_record(60, 20);
      program.draw(grid, PALETTE);
      expect(grid.cells.size).toBeGreaterThan(0);
      expect(program.key).toBeUndefined();
    }
    expect(Object.keys(PROGRAMS).sort()).toEqual(['aquarium', 'cmatrix', 'rain', 'sl', 'snake', 'tetris']);
    expect(program_isName('sl')).toBe(true);
    expect(program_isName('starwars')).toBe(false);
  });

  it('sizes the glyph cell to the field: about a hundred columns, never fewer rows than the arcade needs', () => {
    expect(cell_of(2300, 1300)).toEqual({ w: 23, h: 41 });   // a zoomed pane: big glyphs
    expect(cell_of(2300, 330).w).toBe(8);                    // a short pane: the rows win, at the floor
    expect(cell_of(600, 400)).toEqual({ w: 8, h: 14 });      // a phone: the floor
    expect(cell_of(5000, 3000).w).toBe(26);                  // a wall: the ceiling
  });
});
