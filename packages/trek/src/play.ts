/*
 * play.ts: a TypeScript port of BSD trek(6), from play.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): play.c 1.12 2009/08/12.
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
 * @file The instruction read and main play loop: per-move variables set
 * up, the command read and executed, then events() to use up time,
 * attack() to have Klingons attack if the move was not free, and
 * checkcond() to check up on how we are doing after the move.
 *
 * @module
 */
import { abandon } from './abandon.js';
import { attack } from './attack.js';
import { capture } from './capture.js';
import { checkcond } from './checkcond.js';
import { computer } from './computer.js';
import type { Trek } from './context.js';
import { dcrept } from './dcrept.js';
import { destruct } from './destruct.js';
import { dock, undock } from './dock.js';
import { dumpgame } from './dumpgame.js';
import { events } from './events.js';
import { getcodpar, skiptonl, type Cvntab } from './getpar.js';
import { help } from './help.js';
import { impulse } from './impulse.js';
import { TrekReset } from './io.js';
import { lrscan } from './lrscan.js';
import { phaser } from './phaser.js';
import { rest } from './rest.js';
import { setwarp } from './setwarp.js';
import { shield } from './shield.js';
import { srscan } from './srscan.js';
import type { TrekState } from './state.js';
import { torped } from './torped.js';
import { visual } from './visual.js';
import { dowarp } from './warp.js';

/**
 * Ends the game in play, back to the question of another game.
 *
 * C: `myreset()` in play.c.
 *
 * @param _t - The game, unused.
 * @param _v - The command table value, unused.
 * @throws {TrekReset} Always, unwinding to the main loop as the C's longjmp() did.
 */
async function myreset(_t: Trek, _v: number): Promise<void> {
  throw new TrekReset();
}

/** The commands, as the Command: prompt matches them. */
const Comtab: ReadonlyArray<Cvntab> = [
  { abbrev: 'abandon', full: '', value: abandon, value2: 0 },
  { abbrev: 'ca', full: 'pture', value: capture, value2: 0 },
  { abbrev: 'cl', full: 'oak', value: shield, value2: -1 },
  { abbrev: 'c', full: 'omputer', value: computer, value2: 0 },
  { abbrev: 'da', full: 'mages', value: dcrept, value2: 0 },
  { abbrev: 'destruct', full: '', value: destruct, value2: 0 },
  { abbrev: 'do', full: 'ck', value: dock, value2: 0 },
  { abbrev: 'help', full: '', value: help, value2: 0 },
  { abbrev: 'i', full: 'mpulse', value: impulse, value2: 0 },
  { abbrev: 'l', full: 'rscan', value: lrscan, value2: 0 },
  { abbrev: 'm', full: 'ove', value: dowarp, value2: 0 },
  { abbrev: 'p', full: 'hasers', value: phaser, value2: 0 },
  { abbrev: 'ram', full: '', value: dowarp, value2: 1 },
  { abbrev: 'dump', full: '', value: dumpgame, value2: 0 },
  { abbrev: 'r', full: 'est', value: rest, value2: 0 },
  { abbrev: 'sh', full: 'ield', value: shield, value2: 0 },
  { abbrev: 's', full: 'rscan', value: srscan, value2: 0 },
  { abbrev: 'st', full: 'atus', value: srscan, value2: -1 },
  { abbrev: 'terminate', full: '', value: myreset, value2: 0 },
  { abbrev: 't', full: 'orpedo', value: torped, value2: 0 },
  { abbrev: 'u', full: 'ndock', value: undock, value2: 0 },
  { abbrev: 'v', full: 'isual', value: visual, value2: 0 },
  { abbrev: 'w', full: 'arp', value: setwarp, value2: 0 },
];

/**
 * Runs the main play loop: reads a command, executes it, then lets time pass, the Klingons attack and the ship's condition be checked.
 *
 * INSTRUCTION READ AND MAIN PLAY LOOP
 *
 * Never returns: the game leaves it only by a TrekReset or the end of the game.
 *
 * C: `play()` in play.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @returns Never.
 */
export async function play(t: Trek): Promise<never> {
  const { Move }: TrekState = t.s;
  while (true) {
    Move.free = 1;
    Move.time = 0.0;
    Move.shldchg = 0;
    Move.newquad = 0;
    Move.resting = 0;
    await skiptonl(t, 0);
    const r: Cvntab = await getcodpar(t, '\nCommand', Comtab);
    if (r.value) await r.value(t, r.value2);
    await events(t, 0);
    await attack(t, 0);
    await checkcond(t);
  }
}
