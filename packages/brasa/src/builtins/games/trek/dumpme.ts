/*
 * dumpme.ts: a TypeScript port of BSD trek(6), from dumpme.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): dumpme.c 1.8 2009/05/24.
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
 * @file The ship thrown somewhere in the galaxy: off the negative energy
 * barrier, or through a black hole.
 *
 * @module
 */
import { E_FIXDV, MAXEVENTS, NQUADS, NSECTS } from './consts.js';
import type { Trek } from './context.js';
import { events } from './events.js';
import { franf, ranf } from './rand.js';
import { reschedule } from './schedule.js';
import type { TrekEvent } from './state.js';

/*
**  Dump the starship somewhere in the galaxy
**
**	Parameter is zero if bounce off of negative energy barrier,
**	one if through a black hole
**
**	Note that the quadrant is NOT initialized here.  This must
**	be done from the calling routine.
**
**	Repair of devices must be deferred.
*/

/** Dump the starship somewhere in the galaxy */
export async function dumpme(t: Trek, flag: number): Promise<void> {
  const f: number = flag;
  t.s.Ship.quadx = ranf(t.rnd, NQUADS);
  t.s.Ship.quady = ranf(t.rnd, NQUADS);
  t.s.Ship.sectx = ranf(t.rnd, NSECTS);
  t.s.Ship.secty = ranf(t.rnd, NSECTS);
  const x: number = 1.5 * franf(t.rnd);
  t.s.Move.time += x;
  if (f) {
    t.io.printf('%s falls into a black hole.\n', t.s.Ship.shipname);
  } else {
    t.io.printf('Computer applies full reverse power to avoid hitting the\n');
    t.io.printf('   negative energy barrier.  A space warp was entered.\n');
  }
  /* bump repair dates forward */
  for (let i: number = 0; i < MAXEVENTS; i++) {
    const e: TrekEvent = t.s.Event[i] as TrekEvent;
    if (e.evcode !== E_FIXDV) continue;
    reschedule(t, i, e.date - t.s.Now.date + x);
  }
  await events(t, 1);
  t.io.printf('You are now in quadrant %d,%d.  It is stardate %.2f\n', t.s.Ship.quadx, t.s.Ship.quady, t.s.Now.date);
  t.s.Move.time = 0;
}
