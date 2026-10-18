/*
 * setup.ts: a TypeScript port of BSD trek(6), from setup.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): setup.c 1.13 2009/05/25.
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
 * @file Initializing a game: its length, skill and password are read, and
 * the galaxy, the ship and the event queue are laid out. Game restart and
 * tournament games are handled here.
 *
 * Deviation: the C's tables cast a length or a skill to a function pointer
 * (`(cmdfun)4`); here the number rides in `value2`.
 *
 * @module
 */
import type { Trek } from './context.js';
import {
  CLOAK, COMPUTER, Device, E_ISSUE, E_KATSB, E_KDESB, E_ENSLV, E_LRTB, E_REPRO, E_SNAP, E_SNOVA, ENTERPRISE, GREEN, IMPULSE,
  KM_EA, KM_EB, KM_LA, KM_LB, KM_OA, KM_OB, LIFESUP, LRSCAN, MAXEVENTS, MAXKLQUAD, NDEV, NINHAB, NQUADS, NSECTS, PHASER,
  SHIELD, SINS, SRSCAN, SSRADIO, TOOLARGE, TORPED, WARP, XPORTER,
} from './consts.js';
import { attack } from './attack.js';
import { restartgame } from './dumpgame.js';
import { getcodpar, getstrpar, type Cvntab } from './getpar.js';
import { initquad } from './initquad.js';
import { franf, ranf } from './rand.js';
import { xsched } from './schedule.js';
import { srscan } from './srscan.js';
import type { Quad, TrekEvent, XY } from './state.js';

/** The game lengths. */
export const Lentab: ReadonlyArray<Cvntab> = [
  { abbrev: 's', full: 'hort', value: null, value2: 1 },
  { abbrev: 'm', full: 'edium', value: null, value2: 2 },
  { abbrev: 'l', full: 'ong', value: null, value2: 4 },
  { abbrev: 'restart', full: '', value: null, value2: 0 },
];

/** The skills, in rank order. */
export const Skitab: ReadonlyArray<Cvntab> = [
  { abbrev: 'n', full: 'ovice', value: null, value2: 1 },
  { abbrev: 'f', full: 'air', value: null, value2: 2 },
  { abbrev: 'g', full: 'ood', value: null, value2: 3 },
  { abbrev: 'e', full: 'xpert', value: null, value2: 4 },
  { abbrev: 'c', full: 'ommodore', value: null, value2: 5 },
  { abbrev: 'i', full: 'mpossible', value: null, value2: 6 },
];

/**
 * Truncates a number as a store into a C `char` does.
 *
 * gcc truncates to int, then keeps the low byte, signed.
 *
 * Port: stands in for C's implicit conversion on a store into a `char`.
 *
 * @param n - The number stored.
 * @returns The value the `char` holds, -128 to 127.
 */
function cChar_truncate(n: number): number {
  return (Math.trunc(n) << 24) >> 24;
}

/**
 * Initializes a game: reads its length, skill and password, then lays out the galaxy, the ship and the event queue.
 *
 * INITIALIZE THE GAME
 *
 * The length, skill, and password are read, and the game
 * is initialized.  It is far too difficult to describe all
 * that goes on in here, but it is all straight-line code;
 * give it a look.
 *
 * Game restart and tournament games are handled here.
 *
 * C: `setup()` in setup.c.
 *
 * @param t - The game: state, terminal and random numbers.
 */
export async function setup(t: Trek): Promise<void> {
  const { Game, Param, Now, Ship, Move } = t.s;
  let r: Cvntab;
  let i: number;
  let j: number;
  let d: number;
  let q: Quad;

  while (true) {
    r = await getcodpar(t, 'What length game', Lentab);
    Game.length = r.value2;
    if (Game.length === 0) {
      if (await restartgame(t)) continue;
      return;
    }
    break;
  }
  r = await getcodpar(t, 'What skill game', Skitab);
  Game.skill = r.value2;
  Game.tourn = 0;
  Game.passwd = await getstrpar(t, 'Enter a password', 14, null);
  if (Game.passwd === 'tournament') {
    Game.passwd = await getstrpar(t, 'Enter tournament code', 14, null);
    Game.tourn = 1;
    d = 0;
    for (i = 0; i < Game.passwd.length; i++) d += Game.passwd.charCodeAt(i) << i;
    t.rnd.srandom(d);
  }
  Param.bases = Now.bases = ranf(t.rnd, 6 - Game.skill) + 2;
  if (Game.skill === 6) Param.bases = Now.bases = 1;
  Param.time = Now.time = 6.0 * Game.length + 2.0;
  i = Game.skill;
  j = Game.length;
  Param.klings = Now.klings = cChar_truncate(i * j * 3.5 * (franf(t.rnd) + 0.75));
  if (Param.klings < i * j * 5) Param.klings = Now.klings = cChar_truncate(i * j * 5);
  // numerical overflow problems
  if (Param.klings <= i) Param.klings = Now.klings = 127;
  Param.energy = Ship.energy = 5000;
  Param.torped = Ship.torped = 10;
  Ship.ship = ENTERPRISE;
  Ship.shipname = 'Enterprise';
  Param.shield = Ship.shield = 1500;
  Param.resource = Now.resource = Param.klings * Param.time;
  Param.reserves = Ship.reserves = (6 - Game.skill) * 2.0;
  Param.crew = Ship.crew = 387;
  Param.brigfree = Ship.brigfree = 400;
  Ship.shldup = 1;
  Ship.cond = GREEN;
  Ship.warp = 5.0;
  Ship.warp2 = 25.0;
  Ship.warp3 = 125.0;
  Ship.sinsbad = 0;
  Ship.cloaked = 0;
  Param.date = Now.date = (ranf(t.rnd, 20) + 20) * 100;
  let f: number = Game.skill;
  f = Math.log(f + 0.5);
  for (i = 0; i < NDEV; i++) {
    if ((Device[i] as Device).name.startsWith('*')) Param.damfac[i] = 0;
    else Param.damfac[i] = f;
  }
  // these probabilities must sum to 1000
  Param.damprob[WARP] = 70; // warp drive		 7.0%
  Param.damprob[SRSCAN] = 110; // short range scanners	11.0%
  Param.damprob[LRSCAN] = 110; // long range scanners	11.0%
  Param.damprob[PHASER] = 125; // phasers		12.5%
  Param.damprob[TORPED] = 125; // photon torpedoes	12.5%
  Param.damprob[IMPULSE] = 75; // impulse engines	 7.5%
  Param.damprob[SHIELD] = 150; // shield control	15.0%
  Param.damprob[COMPUTER] = 20; // computer		 2.0%
  Param.damprob[SSRADIO] = 35; // subspace radio	 3.5%
  Param.damprob[LIFESUP] = 30; // life support		 3.0%
  Param.damprob[SINS] = 20; // navigation system	 2.0%
  Param.damprob[CLOAK] = 50; // cloaking device	 5.0%
  Param.damprob[XPORTER] = 80; // transporter		 8.0%
  // check to see that I didn't blow it
  for (i = j = 0; i < NDEV; i++) j += Param.damprob[i] as number;
  if (j !== 1000) {
    t.io.printf('trek: Device probabilities sum to %d\n', j);
    t.io.exit(1);
  }
  Param.dockfac = 0.5;
  Param.regenfac = (5 - Game.skill) * 0.05;
  if (Param.regenfac < 0.0) Param.regenfac = 0.0;
  Param.warptime = 10;
  Param.stopengy = 50;
  Param.shupengy = 40;
  i = Game.skill;
  Param.klingpwr = 100 + 150 * i;
  if (i >= 6) Param.klingpwr += 150;
  Param.phasfac = 0.8;
  Param.hitfac = 0.5;
  Param.klingcrew = 200;
  Param.srndrprob = 0.0035;
  Param.moveprob[KM_OB] = 45;
  Param.movefac[KM_OB] = 0.09;
  Param.moveprob[KM_OA] = 40;
  Param.movefac[KM_OA] = -0.05;
  Param.moveprob[KM_EB] = 40;
  Param.movefac[KM_EB] = 0.075;
  Param.moveprob[KM_EA] = 25 + 5 * Game.skill;
  Param.movefac[KM_EA] = -0.06 * Game.skill;
  Param.moveprob[KM_LB] = 0;
  Param.movefac[KM_LB] = 0.0;
  Param.moveprob[KM_LA] = 10 + 10 * Game.skill;
  Param.movefac[KM_LA] = 0.25;
  Param.eventdly[E_SNOVA] = 0.5;
  Param.eventdly[E_LRTB] = 25.0;
  Param.eventdly[E_KATSB] = 1.0;
  Param.eventdly[E_KDESB] = 3.0;
  Param.eventdly[E_ISSUE] = 1.0;
  Param.eventdly[E_SNAP] = 0.5;
  Param.eventdly[E_ENSLV] = 0.5;
  Param.eventdly[E_REPRO] = 2.0;
  Param.navigcrud[0] = 1.5;
  Param.navigcrud[1] = 0.75;
  Param.cloakenergy = 1000;
  Param.energylow = 1000;
  for (i = 0; i < MAXEVENTS; i++) {
    const e: TrekEvent = t.s.Event[i] as TrekEvent;
    e.date = TOOLARGE;
    e.evcode = 0;
  }
  xsched(t, E_SNOVA, 1, 0, 0, 0);
  xsched(t, E_LRTB, Param.klings, 0, 0, 0);
  xsched(t, E_KATSB, 1, 0, 0, 0);
  xsched(t, E_ISSUE, 1, 0, 0, 0);
  xsched(t, E_SNAP, 1, 0, 0, 0);
  Ship.sectx = ranf(t.rnd, NSECTS);
  Ship.secty = ranf(t.rnd, NSECTS);
  Game.killk = Game.kills = Game.killb = 0;
  Game.deaths = Game.negenbar = 0;
  Game.captives = 0;
  Game.killinhab = 0;
  Game.helps = 0;
  Game.killed = 0;
  Game.snap = 0;
  Move.endgame = 0;

  // setup stars
  for (i = 0; i < NQUADS; i++) {
    for (j = 0; j < NQUADS; j++) {
      q = (t.s.Quad[i] as Quad[])[j] as Quad;
      q.klings = q.bases = 0;
      q.scanned = -1;
      q.stars = ranf(t.rnd, 9) + 1;
      q.holes = ranf(t.rnd, 3);
      const s5: number = Math.trunc(q.stars / 5);
      q.holes = q.holes > s5 ? q.holes - s5 : 0;
      q.qsystemname = 0;
    }
  }

  // select inhabited starsystems
  for (d = 1; d < NINHAB; d++) {
    do {
      i = ranf(t.rnd, NQUADS);
      j = ranf(t.rnd, NQUADS);
      q = (t.s.Quad[i] as Quad[])[j] as Quad;
    } while (q.qsystemname);
    q.qsystemname = d;
  }

  // position starbases
  for (i = 0; i < Param.bases; i++) {
    let ix: number;
    let iy: number;
    while (true) {
      ix = ranf(t.rnd, NQUADS);
      iy = ranf(t.rnd, NQUADS);
      q = (t.s.Quad[ix] as Quad[])[iy] as Quad;
      if (q.bases > 0) continue;
      break;
    }
    q.bases = 1;
    const base: XY = Now.base[i] as XY;
    base.x = ix;
    base.y = iy;
    q.scanned = 1001;
    // start the Enterprise near starbase
    if (i === 0) {
      Ship.quadx = ix;
      Ship.quady = iy;
    }
  }

  // position klingons
  for (i = Param.klings; i > 0; ) {
    let klump: number = ranf(t.rnd, 4) + 1;
    if (klump > i) klump = i;
    while (true) {
      const ix: number = ranf(t.rnd, NQUADS);
      const iy: number = ranf(t.rnd, NQUADS);
      q = (t.s.Quad[ix] as Quad[])[iy] as Quad;
      if (q.klings + klump > MAXKLQUAD) continue;
      q.klings += klump;
      i -= klump;
      break;
    }
  }

  // initialize this quadrant
  const bases: XY[] = Now.base;
  t.io.printf('%d Klingons\n%d starbase', Param.klings, Param.bases);
  if (Param.bases > 1) t.io.printf('s');
  t.io.printf(' at %d,%d', (bases[0] as XY).x, (bases[0] as XY).y);
  for (i = 1; i < Param.bases; i++) t.io.printf(', %d,%d', (bases[i] as XY).x, (bases[i] as XY).y);
  t.io.printf('\nIt takes %d units to kill a Klingon\n', Param.klingpwr);
  Move.free = 0;
  await initquad(t, 0);
  await srscan(t, 1);
  await attack(t, 0);
}
