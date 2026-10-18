/*
 * dumpssradio.ts: a TypeScript port of BSD trek(6), from dumpssradio.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): dumpssradio.c 1.8 2009/05/24.
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
 * @file The hidden distress calls, printed when the subspace radio is
 * back: each one still standing, and those that went quiet meanwhile.
 *
 * @module
 */
import { E_ENSLV, E_GHOST, E_HIDDEN, E_KDESB, E_REPRO, MAXEVENTS } from './consts.js';
import type { Trek } from './context.js';
import { unschedule } from './schedule.js';
import type { TrekEvent } from './state.js';
import { systemname } from './systemname.js';

/**
 * Prints the distress calls hidden while the subspace radio was out.
 *
 * output hidden distress calls
 *
 * Each ghost (a call that went quiet meanwhile) is unscheduled and reported
 * as no longer distressed.
 *
 * C: `dumpssradio()` in dumpssradio.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @returns The number of distress calls still standing.
 */
export function dumpssradio(t: Trek): number {
  let chkrest: number = 0;
  for (let j: number = 0; j < MAXEVENTS; j++) {
    const e: TrekEvent = t.s.Event[j] as TrekEvent;
    /* if it is not hidden, then just ignore it */
    if ((e.evcode & E_HIDDEN) === 0) continue;
    if (e.evcode & E_GHOST) {
      unschedule(t, j);
      t.io.printf('Starsystem %s in quadrant %d,%d is no longer distressed\n', systemname(t, t.s.Quad[e.x][e.y]) ?? '(null)', e.x, e.y);
      continue;
    }

    switch (e.evcode) {
      case E_KDESB:
        t.io.printf('Starbase in quadrant %d,%d is under attack\n', e.x, e.y);
        chkrest++;
        break;

      case E_ENSLV:
      case E_REPRO:
        t.io.printf('Starsystem %s in quadrant %d,%d is distressed\n', systemname(t, t.s.Quad[e.x][e.y]) ?? '(null)', e.x, e.y);
        chkrest++;
        break;
    }
  }

  return chkrest;
}
