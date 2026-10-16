/*
 * help.ts: a TypeScript port of BSD trek(6), from help.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): help.c 1.13 2009/08/12.
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
 * @file Calling a starbase for help: the closest one tries three times to
 * rematerialize the ship beside it.
 *
 * @module
 */
import { DOCKED, EMPTY, L_NOHELP, NSECTS, SSRADIO, TOOLARGE } from './consts.js';
import type { Trek } from './context.js';
import { compkldist } from './compkl.js';
import { damaged } from './damaged.js';
import { dock } from './dock.js';
import { initquad } from './initquad.js';
import { lose } from './lose.js';
import { out } from './out.js';
import { franf, ranf } from './rand.js';
import type { XY } from './state.js';

/*
**  call starbase for help
**
**	First, the closest starbase is selected.  If there is a
**	a starbase in your own quadrant, you are in good shape.
**	This distance takes quadrant distances into account only.
**
**	A magic number is computed based on the distance which acts
**	as the probability that you will be rematerialized.  You
**	get three tries.
**
**	When it is determined that you should be able to be remater-
**	ialized (i.e., when the probability thing mentioned above
**	comes up positive), you are put into that quadrant (anywhere).
**	Then, we try to see if there is a spot adjacent to the star-
**	base.  If not, you can't be rematerialized!!!  Otherwise,
**	it drops you there.  It only tries five times to find a spot
**	to drop you.  After that, it's your problem.
*/

const Cntvect: ReadonlyArray<string> = ['first', 'second', 'third'];

/** call starbase for help */
export async function help(t: Trek, _v: number): Promise<void> {
  let i: number;
  let dist: number;
  let x: number;
  let dx: number = 0;
  let dy: number = 0;
  let j: number;
  let l: number = 0;

  /* check to see if calling for help is reasonable ... */
  if (t.s.Ship.cond === DOCKED) {
    t.io.printf("Uhura: But Captain, we're already docked\n");
    return;
  }

  /* or possible */
  if (damaged(t, SSRADIO)) {
    await out(t, SSRADIO);
    return;
  }
  if (t.s.Now.bases <= 0) {
    t.io.printf("Uhura: I'm not getting any response from starbase\n");
    return;
  }

  /* tut tut, there goes the score */
  t.s.Game.helps += 1;

  /* find the closest base */
  dist = TOOLARGE;
  if (t.s.Quad[t.s.Ship.quadx][t.s.Ship.quady].bases <= 0) {
    /* there isn't one in this quadrant */
    for (i = 0; i < t.s.Now.bases; i++) {
      /* compute distance */
      const base: XY = t.s.Now.base[i] as XY;
      dx = base.x - t.s.Ship.quadx;
      dy = base.y - t.s.Ship.quady;
      x = dx * dx + dy * dy;
      x = Math.sqrt(x);

      /* see if better than what we already have */
      if (x < dist) {
        dist = x;
        l = i;
      }
    }

    /* go to that quadrant */
    const best: XY = t.s.Now.base[l] as XY;
    t.s.Ship.quadx = best.x;
    t.s.Ship.quady = best.y;
    await initquad(t, 1);
  } else {
    dist = 0.0;
  }

  /* dematerialize the Enterprise */
  t.s.Sect[t.s.Ship.sectx][t.s.Ship.secty] = EMPTY;
  t.io.printf('Starbase in %d,%d responds\n', t.s.Ship.quadx, t.s.Ship.quady);

  /* this next thing acts as a probability that it will work */
  x = Math.pow(1.0 - Math.pow(0.94, dist), 0.3333333);

  /* attempt to rematerialize */
  for (i = 0; i < 3; i++) {
    await t.io.sleep(2);
    t.io.printf('%s attempt to rematerialize ', Cntvect[i] as string);
    if (franf(t.rnd) > x) {
      /* ok, that's good.  let's see if we can set her down */
      for (j = 0; j < 5; j++) {
        dx = t.s.Etc.starbase.x + ranf(t.rnd, 3) - 1;
        if (dx < 0 || dx >= NSECTS) continue;
        dy = t.s.Etc.starbase.y + ranf(t.rnd, 3) - 1;
        if (dy < 0 || dy >= NSECTS || t.s.Sect[dx][dy] !== EMPTY) continue;
        break;
      }
      if (j < 5) {
        /* found an empty spot */
        t.io.printf('succeeds\n');
        t.s.Ship.sectx = dx;
        t.s.Ship.secty = dy;
        t.s.Sect[dx][dy] = t.s.Ship.ship;
        await dock(t, 0);
        compkldist(t, 0);
        return;
      }
      /* the starbase must have been surrounded */
    }
    t.io.printf('fails\n');
  }

  /* one, two, three strikes, you're out */
  await lose(t, L_NOHELP);
}
