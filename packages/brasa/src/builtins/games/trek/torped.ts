/*
 * torped.ts: a TypeScript port of BSD trek(6), from torped.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): torped.c 1.14 2009/05/24.
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
 * @file Photon torpedo control: one torpedo, or a burst of three across a
 * spread angle, each on a randomly crudded course that may misfire.
 *
 * @module
 */
import { BASE, DOCKED, EMPTY, HOLE, INHABIT, KLINGON, NSECTS, STAR, TORPED } from './consts.js';
import type { Trek } from './context.js';
import { check_out } from './check_out.js';
import { damage } from './damage.js';
import { damaged } from './damaged.js';
import { getintpar, getynpar, testnl } from './getpar.js';
import { killb, killk, kills } from './kill.js';
import { nova } from './nova.js';
import { franf, ranf } from './rand.js';

/*
**  PHOTON TORPEDO CONTROL
**
**	Either one or three photon torpedoes are fired.  If three
**	are fired, it is called a "burst" and you also specify
**	a spread angle.
**
**	Torpedoes are never 100% accurate.  There is always a random
**	cludge factor in their course which is increased if you have
**	your shields up.  Hence, you will find that they are more
**	accurate at close range.  However, they have the advantage that
**	at long range they don't lose any of their power as phasers
**	do, i.e., a hit is a hit is a hit, by any other name.
**
**	When the course spreads too much, you get a misfire, and the
**	course is randomized even more.  You also have the chance that
**	the misfire damages your torpedo tubes.
*/

/** Photon torpedo control. */
export async function torped(t: Trek, _v: number): Promise<void> {
  const { Ship, Etc, Sect, Game, Move } = t.s;
  let ix: number;
  let iy: number;
  let x: number;
  let y: number;
  let dx: number;
  let dy: number;
  let angle: number;
  let course: number;
  let course2: number;
  let k: number;
  let bigger: number;
  let burst: number;
  let n: number;

  if (Ship.cloaked) {
    t.io.printf('Federation regulations do not permit attack while cloaked.\n');
    return;
  }
  if (check_out(t, TORPED)) return;
  if (Ship.torped <= 0) {
    t.io.printf('All photon torpedos expended\n');
    return;
  }

  /* get the course */
  course = await getintpar(t, 'Torpedo course');
  if (course < 0 || course > 360) return;
  burst = -1;

  /* need at least three torpedoes for a burst */
  if (Ship.torped < 3) {
    t.io.printf('No-burst mode selected\n');
    burst = 0;
  } else {
    /* see if the user wants one */
    if (!(await testnl(t))) {
      k = await t.io.getchar();
      t.io.ungetc(k);
      if (k >= 48 && k <= 57) burst = 1;
    }
  }
  if (burst < 0) {
    burst = await getynpar(t, 'Do you want a burst');
  }
  if (burst) {
    burst = await getintpar(t, 'burst angle');
    if (burst <= 0) return;
    if (burst > 15) {
      t.io.printf('Maximum burst angle is 15 degrees\n');
      return;
    }
  }
  const sectsize: number = NSECTS;
  n = -1;
  if (burst) {
    n = 1;
    course -= burst;
  }
  for (; n && n <= 3; n++) {
    /* select a nice random course */
    course2 = course + (await randcourse(t, n));
    /* convert to radians */
    angle = course2 * 0.0174532925;
    dx = -Math.cos(angle);
    dy = Math.sin(angle);
    bigger = Math.abs(dx);
    x = Math.abs(dy);
    if (x > bigger) bigger = x;
    dx /= bigger;
    dy /= bigger;
    x = Ship.sectx + 0.5;
    y = Ship.secty + 0.5;
    if (Ship.cond !== DOCKED) Ship.torped -= 1;
    t.io.printf('Torpedo track');
    if (n > 0) t.io.printf(', torpedo number %d', n);
    t.io.printf(':\n%6.1f\t%4.1f\n', x, y);
    while (true) {
      ix = Math.trunc((x += dx));
      iy = Math.trunc((y += dy));
      if (x < 0.0 || x >= sectsize || y < 0.0 || y >= sectsize) {
        t.io.printf('Torpedo missed\n');
        break;
      }
      t.io.printf('%6.1f\t%4.1f\n', x, y);
      switch (Sect[ix][iy]) {
        case EMPTY:
          continue;

        case HOLE:
          t.io.printf('Torpedo disappears into a black hole\n');
          break;

        case KLINGON:
          for (k = 0; k < Etc.nkling; k++) {
            if (Etc.klingon[k].x !== ix || Etc.klingon[k].y !== iy) continue;
            Etc.klingon[k].power -= 500 + ranf(t.rnd, 501);
            if (Etc.klingon[k].power > 0) {
              t.io.printf('*** Hit on Klingon at %d,%d: extensive damages\n', ix, iy);
              break;
            }
            await killk(t, ix, iy);
            break;
          }
          break;

        case STAR:
          await nova(t, ix, iy);
          break;

        case INHABIT:
          await kills(t, ix, iy, -1);
          break;

        case BASE:
          await killb(t, Ship.quadx, Ship.quady);
          Game.killb += 1;
          break;

        default:
          t.io.printf('Unknown object %c at %d,%d destroyed\n', Sect[ix][iy], ix, iy);
          Sect[ix][iy] = EMPTY;
          break;
      }
      break;
    }
    if (damaged(t, TORPED) || t.s.Quad[Ship.quadx][Ship.quady].stars < 0) break;
    course += burst;
  }
  Move.free = 0;
}

/*
**  RANDOMIZE COURSE
**
**	This routine randomizes the course for torpedo number 'n'.
**	Other things handled by this routine are misfires, damages
**	to the tubes, etc.
*/

/** Randomize the course for torpedo number n. */
async function randcourse(t: Trek, n: number): Promise<number> {
  const { Ship, Param } = t.s;
  let r: number;
  let d: number;

  d = Math.trunc((franf(t.rnd) + franf(t.rnd) - 1.0) * 20);
  if (Math.abs(d) > 12) {
    t.io.printf('Photon tubes misfire');
    if (n < 0) t.io.printf('\n');
    else t.io.printf(' on torpedo %d\n', n);
    if (ranf(t.rnd, 2)) {
      await damage(t, TORPED, 0.2 * Math.abs(d) * (franf(t.rnd) + 1.0));
    }
    d = Math.trunc(d * (1.0 + 2.0 * franf(t.rnd)));
  }
  if (Ship.shldup || Ship.cond === DOCKED) {
    r = Ship.shield;
    r = 1.0 + r / Param.shield;
    if (Ship.cond === DOCKED) r = 2.0;
    d = Math.trunc(d * r);
  }
  return d;
}
