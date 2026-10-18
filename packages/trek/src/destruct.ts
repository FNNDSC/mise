/*
 * destruct.ts: a TypeScript port of BSD trek(6), from destruct.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): destruct.c 1.10 2009/05/24.
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
 * @file The self destruct sequence: a countdown, the game's password, and
 * whatever is near enough to go up with the ship.
 *
 * @module
 */
import { COMPUTER, L_DSTRCT } from './consts.js';
import type { Trek } from './context.js';
import { damaged } from './damaged.js';
import { getstrpar, skiptonl } from './getpar.js';
import { killk } from './kill.js';
import { lose } from './lose.js';
import { out } from './out.js';
import type { Kling } from './state.js';

/*
**  Self Destruct Sequence
**
**	The computer starts up the self destruct sequence.  Obviously,
**	if the computer is out nothing can happen.  You get a countdown
**	and a request for password.  This must match the password that
**	you entered at the start of the game.
**
**	You get to destroy things when you blow up; hence, it is
**	possible to win the game by destructing if you take the last
**	Klingon with you.
**
**	By the way, the \032 in the message is a ^Z, which is because
**	the terminal in my office is an ADM-3, which uses that char-
**	acter to clear the screen.  I also stick in a \014 (form feed)
**	because that clears some other screens.
**
**	Uses trace flag 41
*/

/** Self Destruct Sequence */
export async function destruct(t: Trek, _v: number): Promise<void> {
  let i: number;

  if (damaged(t, COMPUTER)) {
    await out(t, COMPUTER);
    return;
  }
  t.io.printf('\n\x07 --- WORKING ---\x07\n');
  await t.io.sleep(3);
  /* output the count 10 9 8 7 6 */
  for (i = 10; i > 5; i--) {
    for (let j: number = 10; j > i; j--) t.io.printf('   ');
    t.io.printf('%d\n', i);
    await t.io.sleep(1);
  }
  /* check for password on new line only */
  await skiptonl(t, 0);
  const checkpass: string = await getstrpar(t, 'Enter password verification', 14, null);
  await t.io.sleep(2);
  if (checkpass !== t.s.Game.passwd) {
    t.io.printf('Self destruct sequence aborted\n');
    return;
  }
  t.io.printf('Password verified; self destruct sequence continues:\n');
  await t.io.sleep(2);
  /* output count 5 4 3 2 1 0 */
  for (i = 5; i >= 0; i--) {
    await t.io.sleep(1);
    for (let j: number = 5; j > i; j--) t.io.printf('   ');
    t.io.printf('%d\n', i);
  }
  await t.io.sleep(2);
  t.io.printf('\x1a\x0c***** %s destroyed *****\n', t.s.Ship.shipname);
  t.s.Game.killed = 1;
  /* let's see what we can blow up!!!! */
  const zap: number = 20.0 * t.s.Ship.energy;
  t.s.Game.deaths += t.s.Ship.crew;
  for (i = 0; i < t.s.Etc.nkling; ) {
    const k: Kling = t.s.Etc.klingon[i] as Kling;
    if (k.power * k.dist <= zap) await killk(t, k.x, k.y);
    else i++;
  }
  /* if we didn't kill the last Klingon (detected by killk), */
  /* then we lose.... */
  await lose(t, L_DSTRCT);
}
