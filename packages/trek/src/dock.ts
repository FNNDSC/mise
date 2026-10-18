/*
 * dock.ts: a TypeScript port of BSD trek(6), from dock.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): dock.c 1.10 2009/05/24.
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
 * @file Docking to a starbase and leaving it.
 *
 * @module
 */
import { BASE, DOCKED, E_FIXDV, GREEN, MAXEVENTS, NSECTS } from './consts.js';
import type { Trek } from './context.js';
import { dumpssradio } from './dumpssradio.js';
import { reschedule } from './schedule.js';
import type { TrekEvent } from './state.js';

/*
**  DOCK TO STARBASE
**
**	The starship is docked to a starbase.  For this to work you
**	must be adjacent to a starbase.
**
**	You get your supplies replenished and your captives are
**	disembarked.  Note that your score is updated now, not when
**	you actually take the captives.
**
**	Any repairs that need to be done are rescheduled to take
**	place sooner.  This provides for the faster repairs when you
**	are docked.
*/

/** The dock command. */
export async function dock(t: Trek, _v: number): Promise<void> {
  const { Ship, Param, Game } = t.s;
  let i: number;
  let j: number;
  let ok: number;
  let e: TrekEvent;

  if (Ship.cond === DOCKED) {
    t.io.printf('Chekov: But captain, we are already docked\n');
    return;
  }
  /* check for ok to dock, i.e., adjacent to a starbase */
  ok = 0;
  for (i = Ship.sectx - 1; i <= Ship.sectx + 1 && !ok; i++) {
    if (i < 0 || i >= NSECTS) continue;
    for (j = Ship.secty - 1; j <= Ship.secty + 1; j++) {
      if (j < 0 || j >= NSECTS) continue;
      if (t.s.Sect[i][j] === BASE) {
        ok++;
        break;
      }
    }
  }
  if (!ok) {
    t.io.printf('Chekov: But captain, we are not adjacent to a ' +
      'starbase.\n');
    return;
  }

  /* restore resources */
  Ship.energy = Param.energy;
  Ship.torped = Param.torped;
  Ship.shield = Param.shield;
  Ship.crew = Param.crew;
  Game.captives += Param.brigfree - Ship.brigfree;
  Ship.brigfree = Param.brigfree;

  /* reset ship's defenses */
  Ship.shldup = 0;
  Ship.cloaked = 0;
  Ship.cond = DOCKED;
  Ship.reserves = Param.reserves;

  /* recalibrate space inertial navigation system */
  Ship.sinsbad = 0;

  /* output any saved radio messages */
  dumpssradio(t);

  /* reschedule any device repairs */
  for (i = 0; i < MAXEVENTS; i++) {
    e = t.s.Event[i];
    if (e.evcode !== E_FIXDV) continue;
    reschedule(t, i, (e.date - t.s.Now.date) * Param.dockfac);
  }
}

/*
**  LEAVE A STARBASE
**
**	This is the inverse of dock().  The main function it performs
**	is to reschedule any damages so that they will take longer.
*/

/** The undock command. */
export async function undock(t: Trek, _v: number): Promise<void> {
  const { Ship, Param, Move } = t.s;
  let e: TrekEvent;

  if (Ship.cond !== DOCKED) {
    t.io.printf('Sulu: Pardon me captain, but we are not docked.\n');
    return;
  }
  Ship.cond = GREEN;
  Move.free = 0;

  /* reschedule device repair times (again) */
  for (let i: number = 0; i < MAXEVENTS; i++) {
    e = t.s.Event[i];
    if (e.evcode !== E_FIXDV) continue;
    reschedule(t, i, (e.date - t.s.Now.date) / Param.dockfac);
  }
}
