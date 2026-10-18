/*
 * dcrept.ts: a TypeScript port of BSD trek(6), from dcrept.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): dcrept.c 1.11 2022/05/24.
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
 * @file The damage control report: each broken device and its repair
 * time in flight and docked.
 *
 * @module
 */
import { Device, DOCKED, E_FIXDV, MAXEVENTS } from './consts.js';
import type { Trek } from './context.js';
import type { TrekEvent } from './state.js';

/*
**  damage control report
**
**	Print damages and time to fix.  This is taken from the event
**	list.  A couple of factors are set up, based on whether or not
**	we are docked.  (One of these factors will always be 1.0.)
**	The event list is then scanned for damage fix events, the
**	time until they occur is determined, and printed out.  The
**	magic number DAMFAC is used to tell how much faster you can
**	fix things if you are docked.
*/

/** damage control report */
export async function dcrept(t: Trek, _v: number): Promise<void> {
  let m1: number;
  let m2: number;

  /* set up the magic factors to output the time till fixed */
  if (t.s.Ship.cond === DOCKED) {
    m1 = 1.0 / t.s.Param.dockfac;
    m2 = 1.0;
  } else {
    m1 = 1.0;
    m2 = t.s.Param.dockfac;
  }
  t.io.printf('Damage control report:\n');
  let f: number = 1;

  /* scan for damages */
  for (let i: number = 0; i < MAXEVENTS; i++) {
    const e: TrekEvent = t.s.Event[i] as TrekEvent;
    if (e.evcode !== E_FIXDV) continue;

    /* output the title first time */
    if (f) {
      t.io.printf('\t\t\t  repair times\n');
      t.io.printf('device\t\t\tin flight  docked\n');
      f = 0;
    }

    /* compute time till fixed, then adjust by the magic factors */
    const x: number = e.date - t.s.Now.date;
    t.io.printf('%-24s%7.2f  %7.2f\n', (Device[e.systemname] as Device).name, x * m1 + 0.005, x * m2 + 0.005);

    /* do a little consistency checking */
  }

  /* if everything was ok, reassure the nervous captain */
  if (f) t.io.printf('All devices functional\n');
}
