/*
 * impulse.ts: a TypeScript port of BSD trek(6), from impulse.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): impulse.c 1.10 2009/05/24.
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
 * @file Moving under impulse power.
 *
 * @module
 */
import { DOCKED, IMPULSE } from './consts.js';
import type { Trek } from './context.js';
import { damaged } from './damaged.js';
import { getcodi, type CourseDistance } from './getcodi.js';
import { getynpar } from './getpar.js';
import { move } from './move.js';
import { out } from './out.js';

/**
 **	move under impulse power
 **/

/** The impulse command. */
export async function impulse(t: Trek, _v: number): Promise<void> {
  const { Ship, Move } = t.s;
  let percent: number;

  if (Ship.cond === DOCKED) {
    t.io.printf('Scotty: Sorry captain, but we are still docked.\n');
    return;
  }
  if (damaged(t, IMPULSE)) {
    await out(t, IMPULSE);
    return;
  }
  const codi: CourseDistance | null = await getcodi(t);
  if (codi === null) return;
  const course: number = codi.co;
  const dist: number = codi.value;
  // power is an int, as is the energy: 100 * power / energy divides as ints
  const power: number = Math.trunc(20 + 100 * dist);
  percent = Math.trunc(Math.trunc(100 * power / Ship.energy) + 0.5);
  if (percent >= 85) {
    t.io.printf('Scotty: That would consume %d%% of our remaining ' +
      'energy.\n',
    percent);
    if (!(await getynpar(t, 'Are you sure that is wise'))) return;
    t.io.printf('Aye aye, sir\n');
  }
  const time: number = dist / 0.095;
  percent = Math.trunc(100 * time / t.s.Now.time + 0.5);
  if (percent >= 85) {
    t.io.printf('Spock: That would take %d%% of our remaining time.\n',
      percent);
    if (!(await getynpar(t, 'Are you sure that is wise'))) return;
    t.io.printf("(He's finally gone mad)\n");
  }
  Move.time = await move(t, 0, course, time, 0.095);
  Ship.energy = Math.trunc(Ship.energy - (20 + 100 * Move.time * 0.095));
}
