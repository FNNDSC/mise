/*
 * win.ts: a TypeScript port of BSD trek(6), from win.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): win.c 1.12 2009/05/25.
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
 * @file The game won: the message, the score, a promotion when earned,
 * and back to the question of another game.
 *
 * @module
 */
import type { Trek } from './context.js';
import { ENTERPRISE } from './consts.js';
import { skiptonl, type Cvntab } from './getpar.js';
import { TrekReset } from './io.js';
import { score } from './score.js';
import { Skitab } from './setup.js';

/**
 * Signal game won. The promotion algorithm is, as the C says, pretty off
 * the wall.
 */
export async function win(t: Trek): Promise<never> {
  const { Game, Move, Ship } = t.s;
  await t.io.sleep(1);
  t.io.printf('\nCongratulations, you have saved the Federation\n');
  Move.endgame = 1;

  // print and return the score
  const s: number = score(t);

  // decide if she gets a promotion
  if (Game.helps === 0 && Game.killb === 0 && Game.killinhab === 0 && 5 * Game.kills + Game.deaths < 100 && s >= 1000 && Ship.ship === ENTERPRISE) {
    t.io.printf('In fact, you are promoted one step in rank,\n');
    if (Game.skill >= 6) {
      t.io.printf('to the exalted rank of Commodore Emeritus\n');
    } else {
      let p: Cvntab = Skitab[Game.skill - 1] as Cvntab;
      t.io.printf('from %s%s ', p.abbrev, p.full);
      p = Skitab[Game.skill] as Cvntab;
      t.io.printf('to %s%s\n', p.abbrev, p.full);
    }
  }

  // clean out input, and request new game
  await skiptonl(t, 0);
  throw new TrekReset();
}
