/**
 * @file What a program the GAMES pane runs looks like: a grid of cells it
 * draws into, a clock it steps by, keys it may answer.
 *
 * The pane owns the canvas, the clock and the keyboard; a program owns only
 * its state and its picture. Every program is a plain object made by a
 * factory, so the arcade and the showpieces test as functions.
 *
 * @module
 */

/** The hues a program paints with, read from the pane's theme. */
export interface Palette {
  /** The lit hue (harvest gold in MEDICAL). */
  lit: string;
  /** The quiet hue (butter). */
  dim: string;
  /** An alarm hue (tomato). */
  warn: string;
  /** A cool hue (daybreak). */
  cool: string;
}

/** The cell grid a program draws on: columns × rows of one monospace glyph each. */
export interface Grid {
  cols: number;
  rows: number;
  /** Puts one glyph at a cell, in a hue; off-grid cells are dropped. */
  put: (col: number, row: number, glyph: string, hue: string) => void;
  /** Writes a string left to right from a cell. */
  text: (col: number, row: number, words: string, hue: string) => void;
}

/** One program: a showpiece that only runs, or a game that also listens. */
export interface GameProgram {
  /** The name the bar shows. */
  title: string;
  /** How often `step` runs, in milliseconds. */
  tick: number;
  /** Advances the state one tick; `size` is the grid it will draw on. */
  step: (size: { cols: number; rows: number }, random: () => number) => void;
  /** Paints the state. */
  draw: (grid: Grid, palette: Palette) => void;
  /** Answers a key; true when it was the program's. Absent on a showpiece. */
  key?: (key: string) => boolean;
  /** A line for the bar: the score, the state. */
  status?: () => string;
  /** Whether the game has ended (the clock stops; RESTART starts over). */
  over?: () => boolean;
}

/** The programs by name, as the kernel's `games.show` model names them. */
export type ProgramName = 'sl' | 'cmatrix' | 'rain' | 'aquarium' | 'tetris' | 'snake';
