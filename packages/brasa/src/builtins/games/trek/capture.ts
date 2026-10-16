/*
 * capture.ts: a TypeScript port of BSD trek(6), from capture.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): capture.c 1.12 2009/08/12.
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
 * @file Asking a Klingon to surrender, over the subspace radio.
 *
 * @module
 */
import { SSRADIO } from './consts.js';
import type { Trek } from './context.js';
import { damaged } from './damaged.js';
import { killk } from './kill.js';
import { out } from './out.js';
import { ranf } from './rand.js';
import type { Kling } from './state.js';

/*
**  Ask a Klingon To Surrender
**
**	(Fat chance)
**
**	The Subspace Radio is needed to ask a Klingon if he will kindly
**	surrender.  A random Klingon from the ones in the quadrant is
**	chosen.
**
**	The Klingon is requested to surrender.  The probability of this
**	is a function of that Klingon's remaining power, our power,
**	etc.
*/

/** Ask a Klingon To Surrender */
export async function capture(t: Trek, _v: number): Promise<void> {
  let i: number;

  /* check for not cloaked */
  if (t.s.Ship.cloaked) {
    t.io.printf('Ship-ship communications out when cloaked\n');
    return;
  }
  if (damaged(t, SSRADIO)) {
    await out(t, SSRADIO);
    return;
  }
  /* find out if there are any at all */
  if (t.s.Etc.nkling <= 0) {
    t.io.printf('Uhura: Getting no response, sir\n');
    return;
  }

  /* if there is more than one Klingon, find out which one */
  const k: Kling = selectklingon(t);
  t.s.Move.free = 0;
  t.s.Move.time = 0.05;

  /* check out that Klingon */
  k.srndreq++;
  let x: number = t.s.Param.klingpwr;
  x *= t.s.Ship.energy;
  x /= k.power * t.s.Etc.nkling;
  x *= t.s.Param.srndrprob;
  i = Math.trunc(x);
  if (t.s.Trace) t.io.printf('Prob = %d (%.4f)\n', i, x);
  if (i > ranf(t.rnd, 100)) {
    /* guess what, he surrendered!!! */
    t.io.printf('Klingon at %d,%d surrenders\n', k.x, k.y);
    i = ranf(t.rnd, t.s.Param.klingcrew);
    if (i > 0) t.io.printf('%d klingons commit suicide rather than be taken captive\n', t.s.Param.klingcrew - i);
    if (i > t.s.Ship.brigfree) i = t.s.Ship.brigfree;
    t.s.Ship.brigfree -= i;
    t.io.printf('%d captives taken\n', i);
    await killk(t, k.x, k.y);
    return;
  }

  /* big surprise, he refuses to surrender */
  t.io.printf('Fat chance, captain\n');
  return;
}

/*
**  SELECT A KLINGON
**
**	Cruddy, just takes one at random.  Should ask the captain.
*/

/** SELECT A KLINGON */
function selectklingon(t: Trek): Kling {
  let i: number;

  if (t.s.Etc.nkling < 2) i = 0;
  else i = ranf(t.rnd, t.s.Etc.nkling);
  return t.s.Etc.klingon[i] as Kling;
}
