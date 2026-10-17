/**
 * @file The showpieces and the arcade, as programs on a cell grid: what the
 * kernel's `sl`, `cmatrix`, `rain`, `asciiquarium`, `tetris` and `snake`
 * run. A program owns its state and its picture; whoever plays it (a
 * terminal, ARGUS's GAMES pane) owns the grid, the clock and the keys.
 *
 * @module
 */
import type { GameProgram, ProgramName } from './program.js';
import { sl_make, cmatrix_make, rain_make, aquarium_make } from './shows.js';
import { tetris_make, snake_make } from './arcade.js';

export * from './program.js';
export * from './shows.js';
export * from './arcade.js';

/** The factories by the kernel's program name. */
export const PROGRAMS: Record<ProgramName, () => GameProgram> = {
  sl: sl_make,
  cmatrix: cmatrix_make,
  rain: rain_make,
  aquarium: aquarium_make,
  tetris: tetris_make,
  snake: snake_make,
};

/** Whether a word names a program. */
export function program_isName(word: string): word is ProgramName {
  return word in PROGRAMS;
}
