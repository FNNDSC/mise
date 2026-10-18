/*
 * phaser.ts: a TypeScript port of BSD trek(6), from phaser.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): phaser.c 1.15 2009/08/12.
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
 * @file Phaser control: up to NBANKS banks fired together, aimed by hand
 * (course, units and spread per bank) or automatically (total units,
 * shared out by the computer over the Klingons in the quadrant).
 *
 * Deviation: the C's klingon pointer walking the list is an index here,
 * re-read after each kill, since killk() copies the list down.
 *
 * @module
 */
import { COMPUTER, DOCKED, Device, NBANKS, PHASER, SRSCAN } from './consts.js';
import type { Trek } from './context.js';
import { damaged } from './damaged.js';
import { getcodpar, getfltpar, getintpar, skiptonl, testnl, type Cvntab } from './getpar.js';
import { killk } from './kill.js';
import { out } from './out.js';
import { franf } from './rand.js';
import type { Kling } from './state.js';

/* factors for phaser hits; see description below */

/** spread */
const ALPHA: number = 3.0;
/** franf() */
const BETA: number = 3.0;
/** cos(angle) */
const GAMMA: number = 0.30;
/** dist ** 2 */
const EPSILON: number = 150.0;
/** overall scaling factor */
const OMEGA: number = 10.596;

/* OMEGA ~= 100 * (ALPHA + 1) * (BETA + 1) / (EPSILON + 1) */

/*
**  Phaser Control
**
**	There are up to NBANKS phaser banks which may be fired
**	simultaneously.  There are two modes, "manual" and
**	"automatic".  In manual mode, you specify exactly which
**	direction you want each bank to be aimed, the number
**	of units to fire, and the spread angle.  In automatic
**	mode, you give only the total number of units to fire.
**
**	The spread is specified as a number between zero and
**	one, with zero being minimum spread and one being maximum
**	spread.  You  will normally want zero spread, unless your
**	short range scanners are out, in which case you probably
**	don't know exactly where the Klingons are.  In that case,
**	you really don't have any choice except to specify a
**	fairly large spread.
**
**	Phasers spread slightly, even if you specify zero spread.
**
**	Uses trace flag 30
*/

/** The mode table: value2 carries the C's (cmdfun) 1 / 0. */
const Matab: ReadonlyArray<Cvntab> = [
  { abbrev: 'm', full: 'anual', value: null, value2: 1 },
  { abbrev: 'a', full: 'utomatic', value: null, value2: 0 },
];

/** One phaser bank. */
interface Banks {
  units: number;
  angle: number;
  spread: number;
}

/** Phaser control. */
export async function phaser(t: Trek, _v: number): Promise<void> {
  const { Ship, Etc, Move } = t.s;
  let i: number;
  let j: number;
  let k: Kling;
  let ki: number;
  let dx: number;
  let dy: number;
  let anglefactor: number;
  let distfactor: number;
  let b: Banks;
  let manual: number;
  let flag: number;
  let extra: number = 0;
  let hit: number;
  let tot: number;
  let n: number;
  const hitreqd: number[] = new Array<number>(NBANKS).fill(0);
  const bank: Banks[] = Array.from({ length: NBANKS }, (): Banks => ({ units: 0, angle: 0, spread: 0 }));

  if (Ship.cond === DOCKED) {
    t.io.printf('Phasers cannot fire through starbase shields\n');
    return;
  }
  if (damaged(t, PHASER)) {
    await out(t, PHASER);
    return;
  }
  if (Ship.shldup) {
    t.io.printf('Sulu: Captain, we cannot fire through shields.\n');
    return;
  }
  if (Ship.cloaked) {
    t.io.printf('Sulu: Captain, surely you must realize that we cannot fire\n');
    t.io.printf('  phasers with the cloaking device up.\n');
    return;
  }

  /* decide if we want manual or automatic mode */
  manual = 0;
  if (await testnl(t)) {
    if (damaged(t, COMPUTER)) {
      t.io.printf('%s', Device[COMPUTER].name);
      manual++;
    } else if (damaged(t, SRSCAN)) {
      t.io.printf('%s', Device[SRSCAN].name);
      manual++;
    }
    if (manual) t.io.printf(' damaged, manual mode selected\n');
  }

  if (!manual) {
    const ptr: Cvntab = await getcodpar(t, 'Manual or automatic', Matab);
    manual = ptr.value2;
  }
  if (!manual && damaged(t, COMPUTER)) {
    t.io.printf('Computer damaged, manual selected\n');
    await skiptonl(t, 0);
    manual++;
  }

  /* initialize the bank[] array */
  flag = 1;
  for (i = 0; i < NBANKS; i++) bank[i].units = 0;
  if (manual) {
    /* collect manual mode statistics */
    while (flag) {
      t.io.printf('%d units available\n', Ship.energy);
      extra = 0;
      flag = 0;
      for (i = 0; i < NBANKS; i++) {
        b = bank[i];
        t.io.printf('\nBank %d:\n', i);
        hit = await getintpar(t, 'units');
        if (hit < 0) return;
        if (hit === 0) break;
        extra += hit;
        if (extra > Ship.energy) {
          t.io.printf('available energy exceeded.  ');
          await skiptonl(t, 0);
          flag++;
          break;
        }
        b.units = hit;
        hit = await getintpar(t, 'course');
        if (hit < 0 || hit > 360) return;
        b.angle = hit * 0.0174532925;
        b.spread = await getfltpar(t, 'spread');
        if (b.spread < 0 || b.spread > 1) return;
      }
      Ship.energy -= extra;
    }
    extra = 0;
  } else {
    /* automatic distribution of power */
    if (Etc.nkling <= 0) {
      t.io.printf('Sulu: But there are no Klingons in this quadrant\n');
      return;
    }
    t.io.printf('Phasers locked on target.  ');
    while (flag) {
      t.io.printf('%d units available\n', Ship.energy);
      hit = await getintpar(t, 'Units to fire');
      if (hit <= 0) return;
      if (hit > Ship.energy) {
        t.io.printf('available energy exceeded.  ');
        await skiptonl(t, 0);
        continue;
      }
      flag = 0;
      Ship.energy -= hit;
      extra = hit;
      n = Etc.nkling;
      if (n > NBANKS) n = NBANKS;
      tot = Math.trunc((n * (n + 1)) / 2);
      for (i = 0; i < n; i++) {
        k = Etc.klingon[i];
        b = bank[i];
        distfactor = k.dist;
        anglefactor = (ALPHA * BETA * OMEGA) / (distfactor * distfactor + EPSILON);
        anglefactor *= GAMMA;
        distfactor = k.power;
        distfactor /= anglefactor;
        hitreqd[i] = Math.trunc(distfactor + 0.5);
        dx = Ship.sectx - k.x;
        dy = k.y - Ship.secty;
        b.angle = Math.atan2(dy, dx);
        b.spread = 0.0;
        b.units = Math.trunc(((n - i) / tot) * extra);
        if (t.s.Trace) {
          t.io.printf('b%d hr%d u%d df%.2f af%.2f\n', i, hitreqd[i], b.units, distfactor, anglefactor);
        }
        extra -= b.units;
        hit = b.units - hitreqd[i];
        if (hit > 0) {
          extra += hit;
          b.units -= hit;
        }
      }

      /* give out any extra energy we might have around */
      if (extra > 0) {
        for (i = 0; i < n; i++) {
          b = bank[i];
          hit = hitreqd[i] - b.units;
          if (hit <= 0) continue;
          if (hit >= extra) {
            b.units += extra;
            extra = 0;
            break;
          }
          b.units = hitreqd[i];
          extra -= hit;
        }
        if (extra > 0) t.io.printf('%d units overkill\n', extra);
      }
    }
  }

  if (t.s.Trace) {
    for (i = 0; i < NBANKS; i++) {
      b = bank[i];
      t.io.printf('b%d u%d', i, b.units);
      if (b.units > 0) t.io.printf(' a%.2f s%.2f\n', b.angle, b.spread);
      else t.io.printf('\n');
    }
  }

  /* actually fire the shots */
  Move.free = 0;
  for (i = 0; i < NBANKS; i++) {
    b = bank[i];
    if (b.units <= 0) {
      continue;
    }
    t.io.printf('\nPhaser bank %d fires:\n', i);
    n = Etc.nkling;
    ki = 0;
    for (j = 0; j < n; j++) {
      if (b.units <= 0) break;
      k = Etc.klingon[ki];
      /*
      ** The formula for hit is as follows:
      **
      **  zap = OMEGA * [(sigma + ALPHA) * (rho + BETA)]
      **	/ (dist ** 2 + EPSILON)]
      **	* [cos(delta * sigma) + GAMMA]
      **	* hit
      **
      ** where sigma is the spread factor,
      ** rho is a random number (0 -> 1),
      ** GAMMA is a crud factor for angle (essentially
      **	cruds up the spread factor),
      ** delta is the difference in radians between the
      **	angle you are shooting at and the actual
      **	angle of the klingon,
      ** ALPHA scales down the significance of sigma,
      ** BETA scales down the significance of rho,
      ** OMEGA is the magic number which makes everything
      **	up to "* hit" between zero and one,
      ** dist is the distance to the klingon
      ** hit is the number of units in the bank, and
      ** zap is the amount of the actual hit.
      **
      ** Everything up through dist squared should maximize
      ** at 1.0, so that the distance factor is never
      ** greater than one.  Conveniently, cos() is
      ** never greater than one, but the same restric-
      ** tion applies.
      */
      distfactor = BETA + franf(t.rnd);
      distfactor *= ALPHA + b.spread;
      distfactor *= OMEGA;
      anglefactor = k.dist;
      distfactor /= anglefactor * anglefactor + EPSILON;
      distfactor *= b.units;
      dx = Ship.sectx - k.x;
      dy = k.y - Ship.secty;
      anglefactor = Math.atan2(dy, dx) - b.angle;
      anglefactor = Math.cos(anglefactor * b.spread + GAMMA);
      if (anglefactor < 0.0) {
        ki++;
        continue;
      }
      hit = Math.trunc(anglefactor * distfactor + 0.5);
      k.power -= hit;
      t.io.printf('%d unit hit on Klingon', hit);
      if (!damaged(t, SRSCAN)) t.io.printf(' at %d,%d', k.x, k.y);
      t.io.printf('\n');
      b.units -= hit;
      if (k.power <= 0) {
        await killk(t, k.x, k.y);
        continue;
      }
      ki++;
    }
  }

  /* compute overkill */
  for (i = 0; i < NBANKS; i++) extra += bank[i].units;
  if (extra > 0) t.io.printf('\n%d units expended on empty space\n', extra);
}
