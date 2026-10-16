/*
 * snova.ts: a TypeScript port of BSD trek(6), from snova.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): snova.c 1.10 2018/02/08.
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
 * @file A supernova: in a random quadrant or, set off by the ship, in its
 * own. The quadrant is uninhabitable for the rest of the game; the ship
 * within two sectors of the star is lost.
 *
 * @module
 */
import { INHABIT, L_SNOVA, NQUADS, NSECTS, SSRADIO, STAR } from './consts.js';
import type { Trek } from './context.js';
import { damaged } from './damaged.js';
import { killb, killd } from './kill.js';
import { lose } from './lose.js';
import { ranf } from './rand.js';
import type { Quad } from './state.js';
import { win } from './win.js';

/*
**  CAUSE SUPERNOVA TO OCCUR
**
**	A supernova occurs.  If 'ix' < 0, a random quadrant is chosen;
**	otherwise, the current quadrant is taken, and (ix, iy) give
**	the sector quadrants of the star which is blowing up.
**
**	If the supernova turns out to be in the quadrant you are in,
**	you go into "emergency override mode", which tries to get you
**	out of the quadrant as fast as possible.  However, if you
**	don't have enough fuel, or if you by chance run into something,
**	or some such thing, you blow up anyway.  Oh yeh, if you are
**	within two sectors of the star, there is nothing that can
**	be done for you.
**
**	When a star has gone supernova, the quadrant becomes uninhab-
**	itable for the rest of eternity, i.e., the game.  If you ever
**	try stopping in such a quadrant, you will go into emergency
**	override mode.
*/

/** Cause a supernova to occur. */
export async function snova(t: Trek, x: number, y: number): Promise<void> {
  const { Ship, Sect, Now, Game } = t.s;
  let qx: number;
  let qy: number;
  let ix: number;
  let iy: number = 0;
  let f: number;
  let dx: number;
  let dy: number;
  let n: number;
  let q: Quad;

  f = 0;
  ix = x;
  if (ix < 0) {
    /* choose a quadrant */
    while (true) {
      qx = ranf(t.rnd, NQUADS);
      qy = ranf(t.rnd, NQUADS);
      q = t.s.Quad[qx][qy];
      if (q.stars > 0) break;
    }
    if (Ship.quadx === qx && Ship.quady === qy) {
      /* select a particular star */
      n = ranf(t.rnd, q.stars);
      for (ix = 0; ix < NSECTS; ix++) {
        for (iy = 0; iy < NSECTS; iy++) {
          if (Sect[ix][iy] === STAR || Sect[ix][iy] === INHABIT) {
            if ((n -= 1) <= 0) break;
          }
        }
        if (n <= 0) break;
      }
      f = 1;
    }
  } else {
    /* current quadrant */
    iy = y;
    qx = Ship.quadx;
    qy = Ship.quady;
    q = t.s.Quad[qx][qy];
    f = 1;
  }
  if (f) {
    /* supernova is in same quadrant as Enterprise */
    t.io.printf('\x07\nRED ALERT: supernova occurring at %d,%d\n', ix, iy);
    dx = ix - Ship.sectx;
    dy = iy - Ship.secty;
    if (dx * dx + dy * dy <= 2) {
      t.io.printf('***  Emergency override attem');
      await t.io.sleep(1);
      t.io.printf('\n');
      await lose(t, L_SNOVA);
    }
    q.scanned = 1000;
  } else {
    if (!damaged(t, SSRADIO)) {
      q.scanned = 1000;
      t.io.printf('\nUhura: Captain, Starfleet Command reports a supernova\n');
      t.io.printf('  in quadrant %d,%d.  Caution is advised\n', qx, qy);
    }
  }

  /* clear out the supernova'ed quadrant */
  dx = q.klings;
  dy = q.stars;
  Now.klings -= dx;
  if (x >= 0) {
    /* Enterprise caused supernova */
    Game.kills += dy;
    if (q.bases) await killb(t, qx, qy);
    Game.killk += dx;
  } else {
    if (q.bases) await killb(t, qx, qy);
  }
  await killd(t, qx, qy, x >= 0 ? 1 : 0);
  q.stars = -1;
  q.klings = 0;
  if (Now.klings <= 0) {
    t.io.printf('Lucky devil, that supernova destroyed the last klingon\n');
    await win(t);
  }
}
