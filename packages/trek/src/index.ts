/**
 * @file bsd-trek: the 1976 Berkeley trek game (BSD trek(6)), ported line for
 * line to TypeScript.
 *
 * `trek_play` runs a game on any `TrekTerminal` (something that writes text,
 * asks a question and waits); the `trek` command is one such terminal over
 * stdin and stdout. The game's own modules stay internal: what a terminal
 * needs is exported here.
 *
 * @module
 */
export { trek_play, trekArgs_parse, TREK_USAGE, type TrekPlay, type TrekArgs, type TrekRefusal } from './trek.js';
export { TREK_CREDITS } from './credits.js';
export type { TrekTerminal } from './io.js';
export type { TrekDump } from './context.js';
export type { TrekState, Quad, TrekEvent, Kling, XY, Ship, Game, Move, Param, Now, Etc, Snapshot } from './state.js';
export type { TrekOptions } from './main.js';
