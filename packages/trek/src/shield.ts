/*
 * shield.ts: a TypeScript port of BSD trek(6), from shield.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): shield.c 1.13 2009/08/12.
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
 * @file The shields and the cloaking device: up, down, or asked.
 *
 * Deviation: the C's Udtab carries up/down as `(cmdfun)1` and
 * `(cmdfun)0` in the value slot; here they ride in value2.
 *
 * @module
 */
import { CLOAK, DOCKED, QUEENE, SHIELD, SRSCAN } from './consts.js';
import type { Trek } from './context.js';
import { damaged } from './damaged.js';
import { getcodpar, getynpar, testnl, type Cvntab } from './getpar.js';
import { out } from './out.js';
import { sprintf } from './printf.js';

/** The answers to "Up or down": value2 is 1 for up, 0 for down. */
const Udtab: ReadonlyArray<Cvntab> = [
  { abbrev: 'u', full: 'p', value: null, value2: 1 },
  { abbrev: 'd', full: 'own', value: null, value2: 0 },
];

/**
 * Raises or lowers the shields or the cloaking device, as the command line says or as asked.
 *
 * SHIELD AND CLOAKING DEVICE CONTROL
 *
 * 'f' is one for auto shield up (in case of Condition RED),
 * zero for shield control, and negative one for cloaking
 * device control.
 *
 * Called with an 'up' or 'down' on the same line, it puts
 * the shields/cloak into the specified mode.  Otherwise it
 * reports to the user the current mode, and asks if she wishes
 * to change.
 *
 * This is not a free move.  Hits that occur as a result of
 * this move appear as though the shields are half up/down,
 * so you get partial hits.
 *
 * C: `shield()` in shield.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param f - 1 for auto shield up on Condition RED, 0 for shield control, -1 for cloaking device control.
 */
export async function shield(t: Trek, f: number): Promise<void> {
  let i: number;
  let device: string;
  let dev2: string;
  let dev3: string;
  let ind: number;
  let stat: 'cloaked' | 'shldup';

  if (f > 0 && (t.s.Ship.shldup || damaged(t, SRSCAN))) return;
  if (f < 0) {
    /* cloaking device */
    if (t.s.Ship.ship === QUEENE) {
      t.io.printf('Ye Faire Queene does not have the cloaking device.\n');
      return;
    }
    device = 'Cloaking device';
    dev2 = 'is';
    ind = CLOAK;
    dev3 = 'it';
    stat = 'cloaked';
  } else {
    /* shields */
    device = 'Shields';
    dev2 = 'are';
    dev3 = 'them';
    ind = SHIELD;
    stat = 'shldup';
  }
  if (damaged(t, ind)) {
    if (f <= 0) await out(t, ind);
    return;
  }
  if (t.s.Ship.cond === DOCKED) {
    t.io.printf('%s %s down while docked\n', device, dev2);
    return;
  }
  if (f <= 0 && !(await testnl(t))) {
    const r: Cvntab = await getcodpar(t, 'Up or down', Udtab);
    i = r.value2;
  } else {
    let s: string;
    if (t.s.Ship[stat]) s = sprintf('%s %s up.  Do you want %s down', device, dev2, dev3);
    else s = sprintf('%s %s down.  Do you want %s up', device, dev2, dev3);
    if (!(await getynpar(t, s))) return;
    i = t.s.Ship[stat] ? 0 : 1;
  }
  if (t.s.Ship[stat] === i) {
    t.io.printf('%s already ', device);
    if (i) t.io.printf('up\n');
    else t.io.printf('down\n');
    return;
  }
  if (i) {
    if (f >= 0) t.s.Ship.energy -= t.s.Param.shupengy;
    else t.s.Ship.cloakgood = 0;
  }
  t.s.Move.free = 0;
  if (f >= 0) t.s.Move.shldchg = 1;
  t.s.Ship[stat] = i;
  return;
}
