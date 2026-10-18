/*
 * move.ts: a TypeScript port of BSD trek(6), from move.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): move.c 1.11 2011/07/03.
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
 * @file Moving under warp or impulse power: the course through the
 * current quadrant, leaving it, ramming, black holes and the long range
 * tractor beam that cuts a move short.
 *
 * @module
 */
import { attack } from './attack.js';
import { checkcond } from './checkcond.js';
import { compkldist } from './compkl.js';
import { COMPUTER, E_LRTB, EMPTY, HOLE, L_NEGENB, NQUADS, NSECTS, SINS } from './consts.js';
import type { Trek } from './context.js';
import { damaged } from './damaged.js';
import { dumpme } from './dumpme.js';
import { initquad } from './initquad.js';
import { lose } from './lose.js';
import { ram } from './ram.js';
import { franf } from './rand.js';
import type { TrekState } from './state.js';

/** float.h's DBL_MIN: the smallest normalized double (not Number.MIN_VALUE, which is subnormal). */
const DBL_MIN: number = 2.2250738585072014e-308;

/**
 * Moves the ship under warp or impulse power.
 *
 * Move Under Warp or Impulse Power
 *
 * `Ramflag' is set if we are to be allowed to ram stars,
 * Klingons, etc.  This is passed from warp(), which gets it from
 * either play() or ram().  Course is the course (0 -> 360) at
 * which we want to move.  `Speed' is the speed we
 * want to go, and `time' is the expected time.  It
 * can get cut short if a long range tractor beam is to occur.  We
 * cut short the move so that the user doesn't get docked time and
 * energy for distance which he didn't travel.
 *
 * We check the course through the current quadrant to see that he
 * doesn't run into anything.  After that, though, space sort of
 * bends around him.  Note that this puts us in the awkward posi-
 * tion of being able to be dropped into a sector which is com-
 * pletely surrounded by stars.  Oh Well.
 *
 * If the SINS (Space Inertial Navigation System) is out, we ran-
 * domize the course accordingly before ever starting to move.
 * We will still move in a straight line.
 *
 * Note that if your computer is out, you ram things anyway.  In
 * other words, if your computer and sins are both out, you're in
 * potentially very bad shape.
 *
 * Klingons get a chance to zap you as you leave the quadrant.
 * By the way, they also try to follow you (heh heh).
 *
 * Return value is the actual amount of time used.
 *
 *
 * Uses trace flag 4.
 *
 * C: `move()` in move.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param ramflag - Positive when the ship may ram what is in its way.
 * @param course - The course, 0 .. 360 degrees.
 * @param time - The time the move is expected to take.
 * @param speed - The speed.
 * @returns The time the move actually took.
 */
export async function move(t: Trek, ramflag: number, course: number, time: number, speed: number): Promise<number> {
  const { Ship, Param, Move, Etc }: TrekState = t.s;
  let angle: number;
  let x: number;
  let y: number;
  let dx: number;
  let dy: number;
  let ix: number = 0;
  let iy: number = 0;
  let bigger: number;
  let n: number;
  let i: number;
  let dist: number;
  let evtime: number;

  if (t.s.Trace) {
    t.io.printf('move: ramflag %d course %d time %.2f speed %.2f\n',
      ramflag, course, time, speed);
  }
  const sectsize: number = NSECTS;
  /* initialize delta factors for move */
  angle = course * 0.0174532925;
  if (damaged(t, SINS)) {
    angle += Param.navigcrud[1] * (franf(t.rnd) - 0.5);
  } else if (Ship.sinsbad) {
    angle += Param.navigcrud[0] * (franf(t.rnd) - 0.5);
  }
  dx = -Math.cos(angle);
  dy = Math.sin(angle);
  bigger = Math.abs(dx);
  dist = Math.abs(dy);
  if (dist > bigger) bigger = dist;
  dx /= bigger;
  dy /= bigger;

  /* check for long range tractor beams */
  /****  TEMPORARY CODE == DEBUGGING  ****/
  evtime = t.s.Event[t.s.Now.eventptr[E_LRTB]].date - t.s.Now.date;
  if (t.s.Trace) {
    // the C prints the event pointer with %p; the port prints its index
    t.io.printf('E.ep = %d, ->evcode = %d, ->date = %.2f, ' +
      'evtime = %.2f\n',
    t.s.Now.eventptr[E_LRTB], t.s.Event[t.s.Now.eventptr[E_LRTB]].evcode,
    t.s.Event[t.s.Now.eventptr[E_LRTB]].date, evtime);
  }
  if (time > evtime && Etc.nkling < 3) {
    /* then we got a LRTB */
    evtime += 0.005;
    time = evtime;
  } else {
    evtime = DBL_MIN;
  }
  dist = time * speed;

  /* move within quadrant */
  t.s.Sect[Ship.sectx][Ship.secty] = EMPTY;
  x = Ship.sectx + 0.5;
  y = Ship.secty + 0.5;
  const xn: number = NSECTS * dist * bigger;
  n = Math.trunc(xn + 0.5);
  if (t.s.Trace) {
    t.io.printf('dx = %.2f, dy = %.2f, xn = %.2f, n = %d\n',
      dx, dy, xn, n);
  }
  Move.free = 0;

  for (i = 0; i < n; i++) {
    ix = Math.trunc(x += dx);
    iy = Math.trunc(y += dy);
    if (t.s.Trace) {
      t.io.printf('ix = %d, x = %.2f, iy = %d, y = %.2f\n',
        ix, x, iy, y);
    }
    if (x < 0.0 || y < 0.0 || x >= sectsize || y >= sectsize) {
      /* enter new quadrant */
      dx = Ship.quadx * NSECTS + Ship.sectx + dx * xn;
      dy = Ship.quady * NSECTS + Ship.secty + dy * xn;
      if (dx < 0.0) ix = -1;
      else ix = Math.trunc(dx + 0.5);
      if (dy < 0.0) iy = -1;
      else iy = Math.trunc(dy + 0.5);
      if (t.s.Trace) t.io.printf('New quad: ix = %d, iy = %d\n', ix, iy);
      Ship.sectx = Math.trunc(x);
      Ship.secty = Math.trunc(y);
      compkldist(t, 0);
      Move.newquad = 2;
      await attack(t, 0);
      await checkcond(t);
      Ship.quadx = Math.trunc(ix / NSECTS);
      Ship.quady = Math.trunc(iy / NSECTS);
      Ship.sectx = ix % NSECTS;
      Ship.secty = iy % NSECTS;
      if (ix < 0 || Ship.quadx >= NQUADS || iy < 0 ||
          Ship.quady >= NQUADS) {
        if (!damaged(t, COMPUTER)) {
          await dumpme(t, 0);
        } else {
          await lose(t, L_NEGENB);
        }
      }
      await initquad(t, 0);
      n = 0;
      break;
    }
    if (t.s.Sect[ix][iy] !== EMPTY) {
      /* we just hit something */
      if (!damaged(t, COMPUTER) && ramflag <= 0) {
        ix = Math.trunc(x - dx);
        iy = Math.trunc(y - dy);
        t.io.printf('Computer reports navigation error; ' +
          '%s stopped at %d,%d\n',
        Ship.shipname, ix, iy);
        Ship.energy = Math.trunc(Ship.energy - Param.stopengy * speed);
        break;
      }
      /* test for a black hole */
      if (t.s.Sect[ix][iy] === HOLE) {
        /* get dumped elsewhere in the galaxy */
        await dumpme(t, 1);
        await initquad(t, 0);
        n = 0;
        break;
      }
      await ram(t, ix, iy);
      break;
    }
  }
  if (n > 0) {
    dx = Ship.sectx - ix;
    dy = Ship.secty - iy;
    dist = Math.sqrt(dx * dx + dy * dy) / NSECTS;
    time = dist / speed;
    if (evtime > time) {
      /* spring the LRTB trap */
      time = evtime;
    }
    Ship.sectx = ix;
    Ship.secty = iy;
  }
  t.s.Sect[Ship.sectx][Ship.secty] = Ship.ship;
  compkldist(t, 0);
  return time;
}
