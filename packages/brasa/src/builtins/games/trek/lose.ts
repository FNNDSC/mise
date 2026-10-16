/*
 * lose.ts: a TypeScript port of BSD trek(6), from lose.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): lose.c 1.10 2009/08/12.
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
 * @file The game lost: why, the score, and back to the question of
 * another game.
 *
 * @module
 */
import type { Trek } from './context.js';
import { L_NOTIME } from './consts.js';
import { skiptonl } from './getpar.js';
import { TrekReset } from './io.js';
import { score } from './score.js';

/** The loser messages, by the L_* code less one. */
const Losemsg: ReadonlyArray<string> = [
  'You ran out of time',
  'You ran out of energy',
  'You have been destroyed',
  'You ran into the negative energy barrier',
  "You destroyed yourself by nova'ing that star",
  'You have been caught in a supernova',
  'You just suffocated in outer space',
  'You could not be rematerialized',
  "\n\x1a\x0c ***\x07 Ship's hull has imploded\x07 ***",
  'You have burned up in a star',
  "Well, you destroyed yourself, but it didn't do any good",
  'You have been captured by Klingons and mercilessly tortured',
  'Your last crew member died',
];

/** PRINT OUT LOSER MESSAGES, then the score, and the game is restarted. */
export async function lose(t: Trek, why: number): Promise<never> {
  t.s.Game.killed = 1;
  await t.io.sleep(1);
  t.io.printf('\n%s\n', Losemsg[why - 1] as string);
  switch (why) {
    case L_NOTIME:
      t.s.Game.killed = 0;
      break;
  }
  t.s.Move.endgame = -1;
  score(t);
  await skiptonl(t, 0);
  throw new TrekReset();
}
