/*
 * state.ts: a TypeScript port of BSD trek(6), from trek.h, externs.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): trek.h 1.19 2024/02/10; externs.c 1.10 2009/05/24.
 *
 * Copyright (c) 1980, 1993
 *	The Regents of the University of California.  All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the University nor the names of its contributors
 *    may be used to endorse or promote products derived from this software
 *    without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE REGENTS AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE REGENTS OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 *
 */
/**
 * @file trek's global state, as one object per game.
 *
 * The C keeps everything in globals (Quad, Sect, Event, Ship, Game, Move,
 * Param, Now, Etc); here they are fields of one TrekState, so two sessions
 * never share a galaxy. Field names are the C names. Where the C used a
 * pointer into Event[], the port keeps an index into it (-1 for none), so
 * a snapshot (Etc.snapshot, the time warp) copies cleanly.
 *
 * @module
 */
import { MAXBASES, MAXEVENTS, MAXKLQUAD, NDEV, NEVENTS, NQUADS, NSECTS } from './consts.js';

/** One quadrant of the galaxy. */
export interface Quad {
  /** Number of bases in this quadrant. */
  bases: number;
  /** Number of Klingons in this quadrant. */
  klings: number;
  /** Number of black holes in this quadrant. */
  holes: number;
  /** Star chart entry: -1 unscanned, else 100*klings + 10*bases + stars (1000 for a supernova). */
  scanned: number;
  /** Number of stars in this quadrant (-1 after a supernova). */
  stars: number;
  /** Starsystem name index, with Q_DISTRESSED. */
  qsystemname: number;
}

/** One pending event. */
export interface TrekEvent {
  /** Quadrant row the event happens in. */
  x: number;
  /** Quadrant column the event happens in. */
  y: number;
  /** Trap stardate. */
  date: number;
  /** Event type, with E_GHOST / E_HIDDEN. */
  evcode: number;
  /** Starsystem name. */
  systemname: number;
}

/** One Klingon in the current quadrant. */
export interface Kling {
  /** Sector row. */
  x: number;
  /** Sector column. */
  y: number;
  /** Power left. */
  power: number;
  /** Distance to the Enterprise. */
  dist: number;
  /** Average over this move. */
  avgdist: number;
  /** Set if surrender has been requested. */
  srndreq: number;
}

/** A coordinate pair. */
export interface XY {
  /** Row. */
  x: number;
  /** Column. */
  y: number;
}

/** The starship. */
export interface Ship {
  /** Warp factor. */
  warp: number;
  /** Warp factor squared. */
  warp2: number;
  /** Warp factor cubed. */
  warp3: number;
  /** Shield up flag. */
  shldup: number;
  /** Set if the cloaking device is on. */
  cloaked: number;
  /** Starship's energy. */
  energy: number;
  /** Energy in the shields. */
  shield: number;
  /** Life support reserves. */
  reserves: number;
  /** Ship's complement. */
  crew: number;
  /** Space left in the brig. */
  brigfree: number;
  /** Photon torpedoes left. */
  torped: number;
  /** Set if we have moved. */
  cloakgood: number;
  /** Quadrant row. */
  quadx: number;
  /** Quadrant column. */
  quady: number;
  /** Sector row. */
  sectx: number;
  /** Sector column. */
  secty: number;
  /** Condition code. */
  cond: number;
  /** Set if SINS is working but not calibrated. */
  sinsbad: number;
  /** Name of the current starship. */
  shipname: string;
  /** Current starship: ENTERPRISE or QUEENE. */
  ship: string;
  /** Number of distress calls. */
  distressed: number;
}

/** The game as a whole. */
export interface Game {
  /** Number of Klingons killed. */
  killk: number;
  /** Number of deaths onboard the Enterprise. */
  deaths: number;
  /** Number of hits on the negative energy barrier. */
  negenbar: number;
  /** Number of starbases killed. */
  killb: number;
  /** Number of stars killed. */
  kills: number;
  /** Skill rating of the player. */
  skill: number;
  /** Length of the game. */
  length: number;
  /** Set if you were killed. */
  killed: number;
  /** Number of inhabited starsystems killed. */
  killinhab: number;
  /** Set if a tournament game. */
  tourn: number;
  /** Game password. */
  passwd: string;
  /** Set if a snapshot has been taken. */
  snap: number;
  /** Number of help calls. */
  helps: number;
  /** Total number of captives taken. */
  captives: number;
}

/** This move. */
export interface Move {
  /** Set if a move is free. */
  free: number;
  /** End of game flag. */
  endgame: number;
  /** Set if the shields changed this move. */
  shldchg: number;
  /** Set if a new quadrant was just entered. */
  newquad: number;
  /** Set if this move is a rest. */
  resting: number;
  /** Time used this move. */
  time: number;
}

/** The game's parameters, set by skill and length. */
export interface Param {
  /** Number of starbases at the start. */
  bases: number;
  /** Number of Klingons at the start. */
  klings: number;
  /** Starting stardate. */
  date: number;
  /** Time allowed for the game. */
  time: number;
  /** Federation resources at the start. */
  resource: number;
  /** Starship's full energy. */
  energy: number;
  /** Full energy in the shields. */
  shield: number;
  /** Full life support reserves. */
  reserves: number;
  /** Size of the ship's complement. */
  crew: number;
  /** Maximum possible number of captives. */
  brigfree: number;
  /** Full load of photon torpedoes. */
  torped: number;
  /** Damage factor, by device. */
  damfac: number[];
  /** Docked repair time factor. */
  dockfac: number;
  /** Regeneration factor. */
  regenfac: number;
  /** Energy to do an emergency stop. */
  stopengy: number;
  /** Energy to put up the shields. */
  shupengy: number;
  /** Klingon initial power. */
  klingpwr: number;
  /** Time chewer multiplier for warp. */
  warptime: number;
  /** Klingon phaser power eater factor. */
  phasfac: number;
  /** Probability that a Klingon moves, by move mode (KM_*). */
  moveprob: number[];
  /** Klingon move distance multiplier, by move mode (KM_*). */
  movefac: number[];
  /** Event time multiplier, by event type. */
  eventdly: number[];
  /** Navigation crudup factors. */
  navigcrud: number[];
  /** Cloaking device energy per stardate. */
  cloakenergy: number;
  /** Damage probability, by device (sums to 1000). */
  damprob: number[];
  /** Klingon attack factor. */
  hitfac: number;
  /** Number of Klingons in a crew. */
  klingcrew: number;
  /** Surrender probability. */
  srndrprob: number;
  /** Low energy mark (condition YELLOW). */
  energylow: number;
}

/** The present. */
export interface Now {
  /** Number of starbases left. */
  bases: number;
  /** Number of Klingons left. */
  klings: number;
  /** Current stardate. */
  date: number;
  /** Time left. */
  time: number;
  /** Federation resources left. */
  resource: number;
  /** Number of currently distressed quadrants. */
  distressed: number;
  /** Index into Event[] of each event type's pending event, -1 for none. */
  eventptr: number[];
  /** Locations of starbases. */
  base: XY[];
}

/** What a time warp restores: the galaxy, the events and the present. */
export interface Snapshot {
  /** The galaxy, Quad[x][y]. */
  Quad: Quad[][];
  /** The event list. */
  Event: TrekEvent[];
  /** The present. */
  Now: Now;
}

/** Everything else. */
export interface Etc {
  /** Sorted Klingon list. */
  klingon: Kling[];
  /** Number of Klingons in this sector; < 0 means automatic override mode. */
  nkling: number;
  /** Set if speed > 300 baud. */
  fast: number;
  /** Starbase in the current quadrant. */
  starbase: XY;
  /** Snapshot for the time warp, null before one is taken. */
  snapshot: Snapshot | null;
  /** Set to get a status report on a srscan. */
  statreport: number;
}

/** One game's state. */
export interface TrekState {
  /** The galaxy, Quad[x][y]. */
  Quad: Quad[][];
  /** Current sector map, Sect[x][y]. */
  Sect: string[][];
  /** The pending events. */
  Event: TrekEvent[];
  /** The starship. */
  Ship: Ship;
  /** The game as a whole. */
  Game: Game;
  /** This move. */
  Move: Move;
  /** The game's parameters. */
  Param: Param;
  /** The present. */
  Now: Now;
  /** Everything else. */
  Etc: Etc;
  /** Trace (debug) flag. */
  Trace: number;
}

/**
 * Makes a fresh, zeroed game state (the C's static storage is zeroed too).
 *
 * @returns A new state with every number 0, every event pointer -1 and every sector '\0'.
 */
export function state_create(): TrekState {
  /**
   * Makes one empty quadrant.
   *
   * @returns A quadrant with every count 0.
   */
  const quad_make = (): Quad => ({ bases: 0, klings: 0, holes: 0, scanned: 0, stars: 0, qsystemname: 0 });
  /**
   * Makes one empty event slot.
   *
   * @returns An event with every field 0.
   */
  const event_make = (): TrekEvent => ({ x: 0, y: 0, date: 0, evcode: 0, systemname: 0 });
  /**
   * Makes one empty Klingon slot.
   *
   * @returns A Klingon with every field 0.
   */
  const kling_make = (): Kling => ({ x: 0, y: 0, power: 0, dist: 0, avgdist: 0, srndreq: 0 });
  /**
   * Makes an array of zeros.
   *
   * @param n - The array's length.
   * @returns An array of n zeros.
   */
  const zeros_make = (n: number): number[] => new Array<number>(n).fill(0);
  return {
    Quad: Array.from({ length: NQUADS }, (): Quad[] => Array.from({ length: NQUADS }, quad_make)),
    Sect: Array.from({ length: NSECTS }, (): string[] => new Array<string>(NSECTS).fill('\0')),
    Event: Array.from({ length: MAXEVENTS }, event_make),
    Ship: {
      warp: 0, warp2: 0, warp3: 0, shldup: 0, cloaked: 0, energy: 0, shield: 0, reserves: 0, crew: 0, brigfree: 0,
      torped: 0, cloakgood: 0, quadx: 0, quady: 0, sectx: 0, secty: 0, cond: 0, sinsbad: 0, shipname: '', ship: '\0', distressed: 0,
    },
    Game: { killk: 0, deaths: 0, negenbar: 0, killb: 0, kills: 0, skill: 0, length: 0, killed: 0, killinhab: 0, tourn: 0, passwd: '', snap: 0, helps: 0, captives: 0 },
    Move: { free: 0, endgame: 0, shldchg: 0, newquad: 0, resting: 0, time: 0 },
    Param: {
      bases: 0, klings: 0, date: 0, time: 0, resource: 0, energy: 0, shield: 0, reserves: 0, crew: 0, brigfree: 0, torped: 0,
      damfac: zeros_make(NDEV), dockfac: 0, regenfac: 0, stopengy: 0, shupengy: 0, klingpwr: 0, warptime: 0, phasfac: 0,
      moveprob: zeros_make(6), movefac: zeros_make(6), eventdly: zeros_make(NEVENTS), navigcrud: zeros_make(2), cloakenergy: 0,
      damprob: zeros_make(NDEV), hitfac: 0, klingcrew: 0, srndrprob: 0, energylow: 0,
    },
    Now: { bases: 0, klings: 0, date: 0, time: 0, resource: 0, distressed: 0, eventptr: new Array<number>(NEVENTS).fill(-1), base: Array.from({ length: MAXBASES }, (): XY => ({ x: 0, y: 0 })) },
    Etc: { klingon: Array.from({ length: MAXKLQUAD }, kling_make), nkling: 0, fast: 0, starbase: { x: 0, y: 0 }, snapshot: null, statreport: 0 },
    Trace: 0,
  };
}

/**
 * Takes a snapshot of the galaxy, the events and the present for a time warp.
 *
 * A deep copy of what a snapshot holds (structuredClone keeps no references to the live state).
 *
 * @param s - The game's state.
 * @returns The snapshot.
 */
export function snapshot_take(s: TrekState): Snapshot {
  return structuredClone({ Quad: s.Quad, Event: s.Event, Now: s.Now });
}

/**
 * Puts a snapshot back over the live state.
 *
 * The copy goes in place, as the C's memcpy does, so a routine holding `Now` or a quadrant keeps seeing the live one.
 *
 * @param s - The game's state.
 * @param snap - The snapshot to restore.
 */
export function snapshot_restore(s: TrekState, snap: Snapshot): void {
  const copy: Snapshot = structuredClone(snap);
  // In place, as the C's memcpy: a routine holding `Now` or a quadrant keeps seeing the live one.
  copy.Quad.forEach((row: Quad[], x: number): void => row.forEach((one: Quad, y: number): void => { Object.assign((s.Quad[x] as Quad[])[y] as Quad, one); }));
  copy.Event.forEach((one: TrekEvent, n: number): void => { Object.assign(s.Event[n] as TrekEvent, one); });
  Object.assign(s.Now, copy.Now);
}
