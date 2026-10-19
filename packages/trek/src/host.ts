/**
 * @file What a host that draws the game reads: the state's types and the
 * C's own tables and codes, with none of the engine behind them.
 *
 * `bsd-trek/host` is for a surface that is shown the state (`state_show`)
 * and wants to name what it sees: which device an event repairs, what a
 * condition code is called, which glyph a sector holds. It imports nothing
 * that plays, so a browser bundle that draws a bridge over a game running
 * elsewhere carries no engine.
 *
 * @module
 */
export type { TrekState, Quad, TrekEvent, Kling, XY, Ship, Game, Move, Param, Now, Etc, Snapshot } from './state.js';
export type { TrekTerminal } from './io.js';
export type { Device as TrekDevice } from './consts.js';
export {
  NSECTS, NQUADS,
  EMPTY, STAR, BASE, ENTERPRISE, QUEENE, KLINGON, INHABIT, HOLE,
  NDEV, WARP, SRSCAN, LRSCAN, PHASER, TORPED, IMPULSE, SHIELD, COMPUTER, SSRADIO, LIFESUP, SINS, CLOAK, XPORTER, SHUTTLE,
  E_LRTB, E_KATSB, E_KDESB, E_ISSUE, E_ENSLV, E_REPRO, E_FIXDV, E_ATTACK, E_SNAP, E_SNOVA, E_GHOST, E_HIDDEN, E_EVENT,
  GREEN, DOCKED, YELLOW, RED,
  Q_DISTRESSED, Q_SYSTEM,
  Device, Systemname,
} from './consts.js';
