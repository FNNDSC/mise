/*
 * klmove.ts: a TypeScript port of BSD trek(6), from klmove.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): klmove.c 1.9 2009/05/24.
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
 * @file Moving the Klingons around a quadrant: toward or away from the
 * ship, around stars, and out into the next quadrant.
 *
 * @module
 */
import { compkldist } from './compkl.js';
import { EMPTY, KLINGON, MAXKLQUAD, NQUADS, NSECTS, SRSCAN } from './consts.js';
import type { Trek } from './context.js';
import { damaged } from './damaged.js';
import { ranf } from './rand.js';
import type { Kling, TrekState } from './state.js';

/**
 * Moves the Klingons of the current quadrant.
 *
 * Move Klingons Around
 *
 * This is a largely incomprehensible block of code that moves
 * Klingons around in a quadrant.  It was written in a very
 * "program as you go" fashion, and is a prime candidate for
 * rewriting.
 *
 * The flag `fl' is zero before an attack, one after an attack,
 * and two if you are leaving a quadrant.  This serves to
 * change the probability and distance that it moves.
 *
 * Basically, what it will try to do is to move a certain number
 * of steps either toward you or away from you.  It will avoid
 * stars whenever possible.  Nextx and nexty are the next
 * sector to move to on a per-Klingon basis; they are roughly
 * equivalent to Ship.sectx and Ship.secty for the starship.  Lookx and
 * looky are the sector that you are going to look at to see
 * if you can move their.  Dx and dy are the increment.  Fudgex
 * and fudgey are the things you change around to change your
 * course around stars.
 *
 * C: `klmove()` in klmove.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param fl - 0 before an attack, 1 after an attack, 2 when leaving a quadrant.
 */
export async function klmove(t: Trek, fl: number): Promise<void> {
  const { Ship, Param, Move, Etc }: TrekState = t.s;
  let k: Kling | null;
  let dx: number;
  let dy: number;
  let nextx: number;
  let nexty: number;
  let lookx: number;
  let looky: number;
  let motion: number;
  let fudgex: number;
  let fudgey: number;
  let qx: number;
  let qy: number;
  let bigger: number;
  let i: number;

  if (t.s.Trace) t.io.printf('klmove: fl = %d, Etc.nkling = %d\n', fl, Etc.nkling);
  for (let n: number = 0; n < Etc.nkling; n++) {
    k = Etc.klingon[n];
    i = 100;
    if (fl) i = Math.trunc(100.0 * k.power / Param.klingpwr);
    if (ranf(t.rnd, i) >= Param.moveprob[2 * Move.newquad + fl]) continue;
    /* compute distance to move */
    motion = ranf(t.rnd, 75) - 25;
    motion = Math.trunc(motion * (k.avgdist * Param.movefac[2 * Move.newquad + fl]));
    /* compute direction */
    dx = Ship.sectx - k.x + ranf(t.rnd, 3) - 1;
    dy = Ship.secty - k.y + ranf(t.rnd, 3) - 1;
    bigger = dx;
    if (dy > bigger) bigger = dy;
    if (bigger === 0.0) bigger = 1.0;
    dx = dx / bigger + 0.5;
    dy = dy / bigger + 0.5;
    if (motion < 0) {
      motion = -motion;
      dx = -dx;
      dy = -dy;
    }
    fudgex = fudgey = 1;
    /* try to move the klingon */
    nextx = k.x;
    nexty = k.y;
    for (; motion > 0; motion--) {
      lookx = Math.trunc(nextx + dx);
      looky = Math.trunc(nexty + dy);
      if (lookx < 0 || lookx >= NSECTS ||
          looky < 0 || looky >= NSECTS) {
        /* new quadrant */
        qx = Ship.quadx;
        qy = Ship.quady;
        if (lookx < 0) qx -= 1;
        else if (lookx >= NSECTS) qx += 1;
        if (looky < 0) qy -= 1;
        else if (looky >= NSECTS) qy += 1;
        if (qx < 0 || qx >= NQUADS ||
            qy < 0 || qy >= NQUADS ||
            t.s.Quad[qx][qy].stars < 0 ||
            t.s.Quad[qx][qy].klings > MAXKLQUAD - 1) {
          break;
        }
        if (!damaged(t, SRSCAN)) {
          t.io.printf('Klingon at %d,%d escapes to ' +
            'quadrant %d,%d\n',
          k.x, k.y, qx, qy);
          motion = t.s.Quad[qx][qy].scanned;
          if (motion >= 0 && motion < 1000) t.s.Quad[qx][qy].scanned += 100;
          motion = t.s.Quad[Ship.quadx][Ship.quady].scanned;
          if (motion >= 0 && motion < 1000) t.s.Quad[Ship.quadx][Ship.quady].scanned -= 100;
        }
        t.s.Sect[k.x][k.y] = EMPTY;
        t.s.Quad[qx][qy].klings += 1;
        Etc.nkling -= 1;
        // *k = Etc.klingon[Etc.nkling]: a struct copy into this slot
        Etc.klingon[n] = { ...Etc.klingon[Etc.nkling] };
        t.s.Quad[Ship.quadx][Ship.quady].klings -= 1;
        k = null;
        break;
      }
      if (t.s.Sect[lookx][looky] !== EMPTY) {
        lookx = nextx + fudgex;
        if (lookx < 0 || lookx >= NSECTS) lookx = Math.trunc(nextx + dx);
        if (t.s.Sect[lookx][looky] !== EMPTY) {
          fudgex = -fudgex;
          looky = nexty + fudgey;
          if (looky < 0 || looky >= NSECTS ||
              t.s.Sect[lookx][looky] !== EMPTY) {
            fudgey = -fudgey;
            break;
          }
        }
      }
      nextx = lookx;
      nexty = looky;
    }
    if (k && (k.x !== nextx || k.y !== nexty)) {
      if (!damaged(t, SRSCAN)) {
        t.io.printf('Klingon at %d,%d moves to %d,%d\n',
          k.x, k.y, nextx, nexty);
      }
      t.s.Sect[k.x][k.y] = EMPTY;
      t.s.Sect[k.x = nextx][k.y = nexty] = KLINGON;
    }
  }
  compkldist(t, 0);
}
