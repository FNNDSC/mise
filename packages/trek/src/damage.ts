/*
 * damage.ts: a TypeScript port of BSD trek(6), from damage.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): damage.c 1.8 2009/05/24.
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
 * @file Damage to a device: a repair scheduled, or added to the one
 * already waiting.
 *
 * @module
 */
import { Device, DOCKED, E_FIXDV, MAXEVENTS } from './consts.js';
import type { Trek } from './context.js';
import { damaged } from './damaged.js';
import { reschedule, schedule } from './schedule.js';
import type { TrekEvent } from './state.js';

/*
**  Schedule Ship.damages to a Device
**
**	Device `dev1' is damaged in an amount `dam'.  Dam is measured
**	in stardates, and is an additional amount of damage.  It should
**	be the amount to occur in non-docked mode.  The adjustment
**	to docked mode occurs automatically if we are docked.
**
**	Note that the repair of the device occurs on a DATE, meaning
**	that the dock() and undock() have to reschedule the event.
**
**  dev1 -- device index
**  dam -- time to repair
*/

/** Schedule Ship.damages to a Device */
export async function damage(t: Trek, dev1: number, dam: number): Promise<void> {
  let e: TrekEvent;

  /* ignore zero damages */
  if (dam <= 0.0) return;
  const dev: number = dev1;

  t.io.printf('\t%s damaged\n', (Device[dev] as Device).name);

  /* find actual length till it will be fixed */
  if (t.s.Ship.cond === DOCKED) dam *= t.s.Param.dockfac;
  /* set the damage flag */
  const f: number = damaged(t, dev);
  if (!f) {
    /* new damages -- schedule a fix */
    schedule(t, E_FIXDV, dam, 0, 0, dev);
    return;
  }
  /* device already damaged -- add to existing damages */
  /* scan for old damages */
  for (let i: number = 0; i < MAXEVENTS; i++) {
    e = t.s.Event[i] as TrekEvent;
    if (e.evcode !== E_FIXDV || e.systemname !== dev) continue;
    /* got the right one; add on the new damages */
    reschedule(t, i, e.date - t.s.Now.date + dam);
    return;
  }
  t.io.printf('trek: Cannot find old damages %d\n', dev);
  t.io.exit(1);
}
