/**
 * @file The arcade: `tetris` and `snake`. Each is a `GameProgram` with a
 * `key`, a `status` and an `over`; the boards are plain state so the rules
 * test without a canvas.
 *
 * @module
 */
import type { GameProgram, Grid, Palette } from './program.js';
import { SIDES, SIDE_LIST, type FocusWord } from '../../app/sides.js';

/* -------------------------------------------------------------- tetris */

/** The seven pieces, as cell offsets. */
export const TETROMINOES: ReadonlyArray<ReadonlyArray<[number, number]>> = [
  [[0, 0], [1, 0], [2, 0], [3, 0]],   // I
  [[0, 0], [1, 0], [0, 1], [1, 1]],   // O
  [[1, 0], [0, 1], [1, 1], [2, 1]],   // T
  [[0, 0], [1, 0], [1, 1], [2, 1]],   // Z
  [[1, 0], [2, 0], [0, 1], [1, 1]],   // S
  [[0, 0], [0, 1], [1, 1], [2, 1]],   // J
  [[2, 0], [0, 1], [1, 1], [2, 1]],   // L
];

/** The well is ten wide, twenty tall. */
export const WELL_COLS: number = 10;
export const WELL_ROWS: number = 20;

/** A piece in flight: its cells relative to (x, y). */
export interface Piece { cells: Array<[number, number]>; x: number; y: number; kind: number }

/** The whole game state, plain. */
export interface TetrisState { well: number[][]; piece: Piece | null; score: number; lines: number; over: boolean }

/** A fresh well. */
export function tetris_new(): TetrisState {
  return { well: Array.from({ length: WELL_ROWS }, (): number[] => Array(WELL_COLS).fill(0) as number[]), piece: null, score: 0, lines: 0, over: false };
}

/** Whether the piece fits the well at its place. */
export function piece_fits(well: number[][], piece: Piece): boolean {
  return piece.cells.every(([dx, dy]: [number, number]): boolean => {
    const x: number = piece.x + dx; const y: number = piece.y + dy;
    return x >= 0 && x < WELL_COLS && y < WELL_ROWS && (y < 0 || (well[y] as number[])[x] === 0);
  });
}

/** The piece turned a quarter clockwise about its box. */
export function piece_rotated(piece: Piece): Piece {
  const size: number = Math.max(...piece.cells.flat()) + 1;
  return { ...piece, cells: piece.cells.map(([x, y]: [number, number]): [number, number] => [size - 1 - y, x]) };
}

/** Drops a new piece at the top; the game is over when it does not fit. */
export function tetris_spawn(state: TetrisState, random: () => number): void {
  const kind: number = Math.floor(random() * TETROMINOES.length);
  const piece: Piece = { cells: (TETROMINOES[kind] as ReadonlyArray<[number, number]>).map((c): [number, number] => [c[0], c[1]]), x: 3, y: 0, kind: kind + 1 };
  if (!piece_fits(state.well, piece)) { state.over = true; return; }
  state.piece = piece;
}

/** Fixes the piece into the well and clears full lines. */
export function tetris_lock(state: TetrisState): void {
  const piece: Piece | null = state.piece;
  if (piece === null) return;
  // A piece locked with a cell above the well's lip is the end: the well is full.
  if (piece.cells.some(([, dy]: [number, number]): boolean => piece.y + dy < 0)) state.over = true;
  for (const [dx, dy] of piece.cells) { const y: number = piece.y + dy; if (y >= 0) (state.well[y] as number[])[piece.x + dx] = piece.kind; }
  const kept: number[][] = state.well.filter((row: number[]): boolean => row.some((v: number): boolean => v === 0));
  const cleared: number = WELL_ROWS - kept.length;
  while (kept.length < WELL_ROWS) kept.unshift(Array(WELL_COLS).fill(0) as number[]);
  state.well = kept;
  state.lines += cleared;
  state.score += [0, 100, 300, 500, 800][cleared] ?? 800;
  state.piece = null;
}

/** One gravity tick: the piece falls a row or locks. */
export function tetris_fall(state: TetrisState, random: () => number): void {
  if (state.over) return;
  if (state.piece === null) { tetris_spawn(state, random); return; }
  const moved: Piece = { ...state.piece, y: state.piece.y + 1 };
  if (piece_fits(state.well, moved)) state.piece = moved;
  else tetris_lock(state);
}

/** Answers a key: left/right shift, up turns, down drops one, space drops all the way. */
export function tetris_key(state: TetrisState, key: string, random: () => number): boolean {
  if (state.over || state.piece === null) return false;
  const piece: Piece = state.piece;
  const tryMove = (next: Piece): boolean => { if (piece_fits(state.well, next)) { state.piece = next; return true; } return false; };
  switch (key) {
    case 'ArrowLeft': case 'h': case 'a': tryMove({ ...piece, x: piece.x - 1 }); return true;
    case 'ArrowRight': case 'l': case 'd': tryMove({ ...piece, x: piece.x + 1 }); return true;
    case 'ArrowUp': case 'k': case 'w': tryMove(piece_rotated(piece)) || tryMove({ ...piece_rotated(piece), x: piece.x - 1 }) || tryMove({ ...piece_rotated(piece), x: piece.x + 1 }); return true;
    case 'ArrowDown': case 'j': case 's': tetris_fall(state, random); return true;
    case ' ': { while (state.piece !== null) tetris_fall(state, random); return true; }
    default: return false;
  }
}

/** `tetris`, as a program on the pane. */
export function tetris_make(): GameProgram {
  const state: TetrisState = tetris_new();
  let random: () => number = Math.random;
  return {
    title: 'TETRIS',
    tick: 500,
    step: (_size, rnd): void => { random = rnd; tetris_fall(state, rnd); },
    draw: (grid: Grid, palette: Palette): void => {
      const left: number = Math.max(0, Math.floor((grid.cols - (WELL_COLS * 2 + 2)) / 2));
      const top: number = Math.max(0, Math.floor((grid.rows - WELL_ROWS - 1) / 2));
      const hues: string[] = ['', palette.cool, palette.lit, palette.warn, palette.dim, palette.lit, palette.cool, palette.warn];
      for (let y: number = 0; y < WELL_ROWS; y++) {
        grid.put(left, top + y, '|', palette.dim);
        grid.put(left + WELL_COLS * 2 + 1, top + y, '|', palette.dim);
        for (let x: number = 0; x < WELL_COLS; x++) {
          const v: number = (state.well[y] as number[])[x] as number;
          if (v !== 0) grid.text(left + 1 + x * 2, top + y, '[]', hues[v] as string);
        }
      }
      grid.text(left, top + WELL_ROWS, '+' + '-'.repeat(WELL_COLS * 2) + '+', palette.dim);
      if (state.piece !== null) for (const [dx, dy] of state.piece.cells) { const y: number = state.piece.y + dy; if (y >= 0) grid.text(left + 1 + (state.piece.x + dx) * 2, top + y, '[]', hues[state.piece.kind] as string); }
      if (state.over) grid.text(left + 2, top + 9, ' GAME  OVER ', palette.warn);
    },
    key: (key: string): boolean => tetris_key(state, key, random),
    status: (): string => `${state.score} · ${state.lines} lines${state.over ? ' · OVER' : ''}`,
    over: (): boolean => state.over,
  };
}

/* --------------------------------------------------------------- snake */

/** Where the snake goes next: the screen's own directions, the sides table's words. */
export type Heading = FocusWord;

/** The snake's state: the body head-first, the food, the heading. */
export interface SnakeState { body: Array<[number, number]>; food: [number, number]; heading: Heading; next: Heading; score: number; over: boolean; cols: number; rows: number }

/** A fresh board of a size. */
export function snake_new(cols: number, rows: number, random: () => number): SnakeState {
  const cx: number = cols >> 1; const cy: number = rows >> 1;
  const state: SnakeState = { body: [[cx, cy], [cx - 1, cy], [cx - 2, cy]], food: [0, 0], heading: 'right', next: 'right', score: 0, over: false, cols, rows };
  snake_feed(state, random);
  return state;
}

/** Puts food on a free cell. */
export function snake_feed(state: SnakeState, random: () => number): void {
  for (let tries: number = 0; tries < 1000; tries++) {
    const spot: [number, number] = [Math.floor(random() * state.cols), Math.floor(random() * state.rows)];
    if (!state.body.some(([x, y]: [number, number]): boolean => x === spot[0] && y === spot[1])) { state.food = spot; return; }
  }
}

const OPPOSITE: Record<Heading, Heading> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** Turns, unless the turn would double back. */
export function snake_turn(state: SnakeState, heading: Heading): void {
  if (OPPOSITE[heading] !== state.heading) state.next = heading;
}

/** One step: the head moves; the food grows the snake; a wall or the body ends it. */
export function snake_step(state: SnakeState, random: () => number): void {
  if (state.over) return;
  state.heading = state.next;
  const [hx, hy] = state.body[0] as [number, number];
  const head: [number, number] = state.heading === 'up' ? [hx, hy - 1] : state.heading === 'down' ? [hx, hy + 1] : state.heading === 'left' ? [hx - 1, hy] : [hx + 1, hy];
  const hitsWall: boolean = head[0] < 0 || head[1] < 0 || head[0] >= state.cols || head[1] >= state.rows;
  const hitsSelf: boolean = state.body.some(([x, y]: [number, number]): boolean => x === head[0] && y === head[1]);
  if (hitsWall || hitsSelf) { state.over = true; return; }
  state.body.unshift(head);
  if (head[0] === state.food[0] && head[1] === state.food[1]) { state.score += 10; snake_feed(state, random); }
  else state.body.pop();
}

/** The keys that steer: the arrows as the sides table spells them, and vi's and wasd beside them. */
const SNAKE_KEYS: Readonly<Record<string, Heading>> = {
  ...Object.fromEntries(SIDE_LIST.map((side): [string, Heading] => [SIDES[side].arrow, SIDES[side].focusWord])),
  k: 'up', w: 'up', j: 'down', s: 'down', h: 'left', a: 'left', l: 'right', d: 'right',
};

/** `snake`, as a program on the pane; the board is the grid's size at its first step. */
export function snake_make(): GameProgram {
  let state: SnakeState | null = null;
  return {
    title: 'SNAKE',
    tick: 140,
    step: (size, random): void => {
      if (state === null) state = snake_new(Math.max(8, size.cols >> 1), Math.max(6, size.rows - 1), random);
      snake_step(state, random);
    },
    draw: (grid: Grid, palette: Palette): void => {
      if (state === null) return;
      grid.text(0, state.rows, '-'.repeat(state.cols * 2), palette.dim);
      grid.text(state.food[0] * 2, state.food[1], '**', palette.warn);
      state.body.forEach(([x, y]: [number, number], i: number): void => grid.text(x * 2, y, i === 0 ? '@@' : 'oo', i === 0 ? palette.lit : palette.cool));
      if (state.over) grid.text(Math.max(0, state.cols - 6), state.rows >> 1, ' GAME  OVER ', palette.warn);
    },
    key: (key: string): boolean => {
      const heading: Heading | undefined = SNAKE_KEYS[key];
      if (heading === undefined || state === null) return false;
      snake_turn(state, heading);
      return true;
    },
    status: (): string => (state === null ? '' : `${state.score}${state.over ? ' · OVER' : ''}`),
    over: (): boolean => state?.over ?? false,
  };
}
