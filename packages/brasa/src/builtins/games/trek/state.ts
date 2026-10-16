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
  x: number;
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
  x: number;
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
  x: number;
  y: number;
}

/** The starship. */
export interface Ship {
  warp: number;
  warp2: number;
  warp3: number;
  /** Shield up flag. */
  shldup: number;
  /** Set if the cloaking device is on. */
  cloaked: number;
  energy: number;
  shield: number;
  /** Life support reserves. */
  reserves: number;
  crew: number;
  /** Space left in the brig. */
  brigfree: number;
  torped: number;
  /** Set if we have moved. */
  cloakgood: number;
  quadx: number;
  quady: number;
  sectx: number;
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
  killk: number;
  deaths: number;
  negenbar: number;
  killb: number;
  kills: number;
  skill: number;
  length: number;
  killed: number;
  killinhab: number;
  tourn: number;
  passwd: string;
  snap: number;
  helps: number;
  captives: number;
}

/** This move. */
export interface Move {
  free: number;
  endgame: number;
  shldchg: number;
  newquad: number;
  resting: number;
  time: number;
}

/** The game's parameters, set by skill and length. */
export interface Param {
  bases: number;
  klings: number;
  date: number;
  time: number;
  resource: number;
  energy: number;
  shield: number;
  reserves: number;
  crew: number;
  brigfree: number;
  torped: number;
  damfac: number[];
  dockfac: number;
  regenfac: number;
  stopengy: number;
  shupengy: number;
  klingpwr: number;
  warptime: number;
  phasfac: number;
  moveprob: number[];
  movefac: number[];
  eventdly: number[];
  navigcrud: number[];
  cloakenergy: number;
  damprob: number[];
  hitfac: number;
  klingcrew: number;
  srndrprob: number;
  energylow: number;
}

/** The present. */
export interface Now {
  bases: number;
  klings: number;
  date: number;
  time: number;
  resource: number;
  distressed: number;
  /** Index into Event[] of each event type's pending event, -1 for none. */
  eventptr: number[];
  /** Locations of starbases. */
  base: XY[];
}

/** What a time warp restores: the galaxy, the events and the present. */
export interface Snapshot {
  Quad: Quad[][];
  Event: TrekEvent[];
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
  Quad: Quad[][];
  /** Current sector map, Sect[x][y]. */
  Sect: string[][];
  Event: TrekEvent[];
  Ship: Ship;
  Game: Game;
  Move: Move;
  Param: Param;
  Now: Now;
  Etc: Etc;
  Trace: number;
}

/** A fresh, zeroed game state (the C's static storage is zeroed too). */
export function state_new(): TrekState {
  const quad = (): Quad => ({ bases: 0, klings: 0, holes: 0, scanned: 0, stars: 0, qsystemname: 0 });
  const event = (): TrekEvent => ({ x: 0, y: 0, date: 0, evcode: 0, systemname: 0 });
  const kling = (): Kling => ({ x: 0, y: 0, power: 0, dist: 0, avgdist: 0, srndreq: 0 });
  const zeros = (n: number): number[] => new Array<number>(n).fill(0);
  return {
    Quad: Array.from({ length: NQUADS }, (): Quad[] => Array.from({ length: NQUADS }, quad)),
    Sect: Array.from({ length: NSECTS }, (): string[] => new Array<string>(NSECTS).fill('\0')),
    Event: Array.from({ length: MAXEVENTS }, event),
    Ship: {
      warp: 0, warp2: 0, warp3: 0, shldup: 0, cloaked: 0, energy: 0, shield: 0, reserves: 0, crew: 0, brigfree: 0,
      torped: 0, cloakgood: 0, quadx: 0, quady: 0, sectx: 0, secty: 0, cond: 0, sinsbad: 0, shipname: '', ship: '\0', distressed: 0,
    },
    Game: { killk: 0, deaths: 0, negenbar: 0, killb: 0, kills: 0, skill: 0, length: 0, killed: 0, killinhab: 0, tourn: 0, passwd: '', snap: 0, helps: 0, captives: 0 },
    Move: { free: 0, endgame: 0, shldchg: 0, newquad: 0, resting: 0, time: 0 },
    Param: {
      bases: 0, klings: 0, date: 0, time: 0, resource: 0, energy: 0, shield: 0, reserves: 0, crew: 0, brigfree: 0, torped: 0,
      damfac: zeros(NDEV), dockfac: 0, regenfac: 0, stopengy: 0, shupengy: 0, klingpwr: 0, warptime: 0, phasfac: 0,
      moveprob: zeros(6), movefac: zeros(6), eventdly: zeros(NEVENTS), navigcrud: zeros(2), cloakenergy: 0,
      damprob: zeros(NDEV), hitfac: 0, klingcrew: 0, srndrprob: 0, energylow: 0,
    },
    Now: { bases: 0, klings: 0, date: 0, time: 0, resource: 0, distressed: 0, eventptr: new Array<number>(NEVENTS).fill(-1), base: Array.from({ length: MAXBASES }, (): XY => ({ x: 0, y: 0 })) },
    Etc: { klingon: Array.from({ length: MAXKLQUAD }, kling), nkling: 0, fast: 0, starbase: { x: 0, y: 0 }, snapshot: null, statreport: 0 },
    Trace: 0,
  };
}

/** A deep copy of what a snapshot holds (structuredClone keeps no references to the live state). */
export function snapshot_take(s: TrekState): Snapshot {
  return structuredClone({ Quad: s.Quad, Event: s.Event, Now: s.Now });
}

/** Puts a snapshot back over the live state. */
export function snapshot_restore(s: TrekState, snap: Snapshot): void {
  const copy: Snapshot = structuredClone(snap);
  // In place, as the C's memcpy: a routine holding `Now` or a quadrant keeps seeing the live one.
  copy.Quad.forEach((row: Quad[], x: number): void => row.forEach((one: Quad, y: number): void => { Object.assign((s.Quad[x] as Quad[])[y] as Quad, one); }));
  copy.Event.forEach((one: TrekEvent, n: number): void => { Object.assign(s.Event[n] as TrekEvent, one); });
  Object.assign(s.Now, copy.Now);
}
