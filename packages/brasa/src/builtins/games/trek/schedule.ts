/*
 * schedule.ts: a TypeScript port of BSD trek(6), from schedule.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): schedule.c 1.12 2022/05/22.
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
 * @file The event queue: scheduling, rescheduling and unscheduling an
 * event, and the abbreviated forms whose dates are drawn at random.
 *
 * An event is named by its slot in `Event`; -1 stands for the C's NULL.
 *
 * @module
 */
import type { Trek } from './context.js';
import { E_EVENT, E_GHOST, MAXEVENTS, TOOLARGE } from './consts.js';
import { franf } from './rand.js';
import type { TrekEvent } from './state.js';

/**
 * SCHEDULE AN EVENT: an event of type 'type' is scheduled for time NOW +
 * 'offset' into the first available slot; 'x', 'y' and 'z' are its
 * attributes. The slot is returned.
 */
export function schedule(t: Trek, type: number, offset: number, x: number, y: number, z: number): number {
  const date: number = t.s.Now.date + offset;
  for (let i: number = 0; i < MAXEVENTS; i++) {
    const e: TrekEvent = t.s.Event[i] as TrekEvent;
    if (e.evcode) continue;
    // got a slot
    if (t.s.Trace) t.io.printf('schedule: type %d @ %.2f slot %d parm %d %d %d\n', type, date, i, x, y, z);
    e.evcode = type;
    e.date = date;
    e.x = x;
    e.y = y;
    e.systemname = z;
    t.s.Now.eventptr[type & ~E_GHOST] = i;
    return i;
  }
  t.io.printf('trek: Cannot schedule event %d parm %d %d %d\n', type, x, y, z);
  return t.io.exit(1);
}

/** RESCHEDULE AN EVENT: the event in slot 'e' is rescheduled to the current time plus 'offset'. */
export function reschedule(t: Trek, e: number, offset: number): void {
  const ev: TrekEvent = t.s.Event[e] as TrekEvent;
  const date: number = t.s.Now.date + offset;
  ev.date = date;
  if (t.s.Trace) t.io.printf('reschedule: type %d parm %d %d %d @ %.2f\n', ev.evcode, ev.x, ev.y, ev.systemname, date);
}

/** UNSCHEDULE AN EVENT: the event at slot 'e' is deleted. */
export function unschedule(t: Trek, e: number): void {
  const ev: TrekEvent = t.s.Event[e] as TrekEvent;
  if (t.s.Trace) t.io.printf('unschedule: type %d @ %.2f parm %d %d %d\n', ev.evcode, ev.date, ev.x, ev.y, ev.systemname);
  t.s.Now.eventptr[ev.evcode & E_EVENT] = -1;
  ev.date = TOOLARGE;
  ev.evcode = 0;
}

/** Abbreviated schedule routine: the event index and a factor for the time figure. */
export function xsched(t: Trek, ev: number, factor: number, x: number, y: number, z: number): number {
  const when: number = -(t.s.Param.eventdly[ev] as number) * t.s.Param.time * Math.log(franf(t.rnd)) / factor;
  return schedule(t, ev, when, x, y, z);
}

/** Simplified reschedule routine: the event, its index and the division factor. */
export function xresched(t: Trek, e: number, ev: number, factor: number): void {
  const when: number = -(t.s.Param.eventdly[ev] as number) * t.s.Param.time * Math.log(franf(t.rnd)) / factor;
  reschedule(t, e, when);
}
