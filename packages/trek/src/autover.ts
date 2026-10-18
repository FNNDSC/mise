/*
 * autover.ts: a TypeScript port of BSD trek(6), from autover.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): autover.c 1.7 2009/05/24.
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
 * @file Automatic override: hurling the ship out of a supernova quadrant
 * at a random warp over 6.0.
 *
 * @module
 */
import { attack } from './attack.js';
import { RED } from './consts.js';
import type { Trek } from './context.js';
import { franf, ranf } from './rand.js';
import { warp } from './warp.js';

/*
**  Automatic Override
**
**	If we should be so unlucky as to be caught in a quadrant
**	with a supernova in it, this routine is called.  It is
**	called from checkcond().
**
**	It sets you to a random warp (guaranteed to be over 6.0)
**	and starts sending you off "somewhere" (whereever that is).
**
**	Please note that it is VERY important that you reset your
**	warp speed after the automatic override is called.  The new
**	warp factor does not stay in effect for just this routine.
**
**	This routine will never try to send you more than sqrt(2)
**	quadrants, since that is all that is needed.
*/

/** Sends the ship out of a supernova quadrant. */
export async function autover(t: Trek): Promise<void> {
  const { Ship, Etc } = t.s;
  let dist: number;

  t.io.printf('\x07RED ALERT:  The %s is in a supernova quadrant\n',
    Ship.shipname);
  t.io.printf('***  Emergency override attempts to hurl %s to safety\n',
    Ship.shipname);
  /* let's get our ass out of here */
  Ship.warp = 6.0 + 2.0 * franf(t.rnd);
  Ship.warp2 = Ship.warp * Ship.warp;
  Ship.warp3 = Ship.warp2 * Ship.warp;
  dist = 0.75 * Ship.energy / (Ship.warp3 * (Ship.shldup + 1));
  if (dist > 1.4142) dist = 1.4142;
  const course: number = ranf(t.rnd, 360);
  Etc.nkling = -1;
  Ship.cond = RED;
  await warp(t, -1, course, dist);
  await attack(t, 0);
}
