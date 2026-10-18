/*
 * warp.ts: a TypeScript port of BSD trek(6), from warp.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): warp.c 1.11 2009/05/24.
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
 * @file Moving under warp power: the "move" and "ram" commands, and the
 * emergency override, with the time warps and damage of moving too fast.
 *
 * Deviation: the negative time portal's snapshot is a structured copy of
 * the quadrants, events and Now (snapshot_take), where the C copied their
 * bytes into Etc.snapshot.
 *
 * @module
 */
import { DOCKED, E_FIXDV, E_LRTB, L_TOOFAST, MAXEVENTS, NDEV, WARP } from './consts.js';
import type { Trek } from './context.js';
import { damage } from './damage.js';
import { damaged } from './damaged.js';
import { getcodi, type CourseDistance } from './getcodi.js';
import { getynpar } from './getpar.js';
import { lose } from './lose.js';
import { move } from './move.js';
import { out } from './out.js';
import { franf, ranf } from './rand.js';
import { reschedule } from './schedule.js';
import { snapshot_take, type TrekState } from './state.js';

/**
 * The move and ram commands: asks the course and distance, then warps.
 *
 * MOVE UNDER WARP POWER
 *
 * This is both the "move" and the "ram" commands, differing
 * only in the flag 'fl'.  It is also used for automatic
 * emergency override mode, when 'fl' is < 0 and 'c' and 'd'
 * are the course and distance to be moved.  If 'fl' >= 0,
 * the course and distance are asked of the captain.
 *
 * The guts of this routine are in the routine move(), which
 * is shared with impulse().  Also, the working part of this
 * routine is very small; the rest is to handle the slight chance
 * that you may be moving at some riduculous speed.  In that
 * case, there is code to handle time warps, etc.
 *
 * C: `dowarp()` in warp.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param fl - 0 for move, 1 for ram (the command table's value).
 */
export async function dowarp(t: Trek, fl: number): Promise<void> {
  const codi: CourseDistance | null = await getcodi(t);
  if (codi === null) return;
  await warp(t, fl, codi.co, codi.value);
}

/**
 * Moves under warp power on course c for distance d.
 *
 * Asks before a move that would use 85% or more of the energy or time
 * left, damages the warp engines now and then above warp 6, and above
 * warp 9 risks a time warp or extreme damage.
 *
 * C: `warp()` in warp.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param fl - 0 for move, 1 for ram, < 0 for emergency override.
 * @param c - The course, 0 .. 360 degrees.
 * @param d - The distance, in quadrants.
 */
export async function warp(t: Trek, fl: number, c: number, d: number): Promise<void> {
  const { Ship, Param, Move, Game }: TrekState = t.s;
  let percent: number;

  if (Ship.cond === DOCKED) {
    t.io.printf('%s is docked\n', Ship.shipname);
    return;
  }
  if (damaged(t, WARP)) {
    await out(t, WARP);
    return;
  }

  const course: number = c;
  let dist: number = d;

  /* check to see that we are not using an absurd amount of power */
  const power: number = (dist + 0.05) * Ship.warp3;
  percent = Math.trunc(100 * power / Ship.energy + 0.5);
  if (percent >= 85) {
    t.io.printf('Scotty: That would consume %d%% of our remaining ' +
      'energy.\n',
    percent);
    if (!(await getynpar(t, 'Are you sure that is wise'))) return;
  }

  /* compute the speed we will move at, and the time it will take */
  const speed: number = Ship.warp2 / Param.warptime;
  let time: number = dist / speed;

  /* check to see that that value is not ridiculous */
  percent = Math.trunc(100 * time / t.s.Now.time + 0.5);
  if (percent >= 85) {
    t.io.printf('Spock: That would take %d%% of our remaining time.\n',
      percent);
    if (!(await getynpar(t, 'Are you sure that is wise'))) return;
  }

  /* compute how far we will go if we get damages */
  if (Ship.warp > 6.0 && ranf(t.rnd, 100) < 20 + 15 * (Ship.warp - 6.0)) {
    const frac: number = franf(t.rnd);
    dist *= frac;
    time *= frac;
    const repairs: number = (frac + 1.0) * Ship.warp * (franf(t.rnd) + 0.25) * 0.20;
    await damage(t, WARP, repairs);
  }

  /* do the move */
  Move.time = await move(t, fl, course, time, speed);

  /* see how far we actually went, and decrement energy appropriately */
  dist = Move.time * speed;
  Ship.energy = Math.trunc(Ship.energy - dist * Ship.warp3 * (Ship.shldup + 1));

  /* test for bizarre events */
  if (Ship.warp <= 9.0) return;
  t.io.printf('\n\n  ___ Speed exceeding warp nine ___\n\n');
  await t.io.sleep(2);
  t.io.printf("Ship's safety systems malfunction\n");
  await t.io.sleep(2);
  t.io.printf('Crew experiencing extreme sensory distortion\n');
  await t.io.sleep(4);
  if (ranf(t.rnd, 100) >= 100 * dist) {
    t.io.printf('Equilibrium restored -- all systems normal\n');
    return;
  }

  /* select a bizzare thing to happen to us */
  percent = ranf(t.rnd, 100);
  if (percent < 70) {
    /* time warp */
    if (percent < 35 || !Game.snap) {
      /* positive time warp */
      time = (Ship.warp - 8.0) * dist * (franf(t.rnd) + 1.0);
      t.s.Now.date += time;
      t.io.printf('Positive time portal entered -- ' +
        'it is now Stardate %.2f\n',
      t.s.Now.date);
      for (let i: number = 0; i < MAXEVENTS; i++) {
        percent = t.s.Event[i].evcode;
        if (percent === E_FIXDV || percent === E_LRTB) t.s.Event[i].date += time;
      }
      return;
    }

    /* s/he got lucky: a negative time portal */
    time = t.s.Now.date;
    t.s.Etc.snapshot = snapshot_take(t.s);
    t.io.printf('Negative time portal entered -- ' +
      'it is now Stardate %.2f\n',
    t.s.Now.date);
    for (let i: number = 0; i < MAXEVENTS; i++) {
      if (t.s.Event[i].evcode === E_FIXDV) reschedule(t, i, t.s.Event[i].date - time);
    }
    return;
  }

  /* test for just a lot of damage */
  if (percent < 80) await lose(t, L_TOOFAST);
  t.io.printf('Equilibrium restored -- ' +
    'extreme damage occurred to ship systems\n');
  for (let i: number = 0; i < NDEV; i++) {
    await damage(t, i, (3.0 * (franf(t.rnd) + franf(t.rnd)) + 1.0) * Param.damfac[i]);
  }
  Ship.shldup = 0;
}
