/*
 * score.ts: a TypeScript port of BSD trek(6), from score.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): score.c 1.11 2009/05/25.
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
 * @file The score: each item that counts, and the total.
 *
 * @module
 */
import type { Trek } from './context.js';
import { ENTERPRISE } from './consts.js';
import type { Cvntab } from './getpar.js';
import { sprintf, type PrintfArg } from './printf.js';
import { Skitab } from './setup.js';

/** One line of the score; nothing when it is worth nothing. */
function scoreitem(t: Trek, amount: number, descfmt: string, ...args: PrintfArg[]): void {
  if (amount === 0) return;
  // vsnprintf into char buf[128]
  const buf: string = sprintf(descfmt, ...args).slice(0, 127);
  t.io.printf('%-40s %10ld\n', buf, amount);
}

/** PRINT OUT THE CURRENT SCORE */
export function score(t: Trek): number {
  const { Game, Param, Now, Move, Ship } = t.s;
  let u: number;
  let tt: number;
  let s: number;
  let r: number;

  t.io.printf('\n*** Your score:\n');

  s = tt = Math.trunc(Param.klingpwr / 4) * (u = Game.killk);
  scoreitem(t, tt, '%d Klingons killed', u);

  r = Now.date - Param.date;
  if (r < 1.0) r = 1.0;
  r = Game.killk / r;
  s += tt = Math.trunc(400 * r);
  scoreitem(t, tt, 'Kill rate %.2f Klingons/stardate', r);

  r = Now.klings;
  r /= Game.killk + 1;
  s += tt = Math.trunc(-400 * r);
  scoreitem(t, tt, 'Penalty for %d klingons remaining', Now.klings);

  if (Move.endgame > 0) {
    s += tt = 100 * (u = Game.skill);
    const p: Cvntab = Skitab[u - 1] as Cvntab;
    scoreitem(t, tt, 'Bonus for winning a %s%s game', p.abbrev, p.full);
  }

  if (Game.killed) {
    s -= 500;
    scoreitem(t, -500, 'Penalty for getting killed');
  }

  s += tt = -100 * (u = Game.killb);
  scoreitem(t, tt, '%d starbases killed', u);

  s += tt = -100 * (u = Game.helps);
  scoreitem(t, tt, '%d calls for help', u);

  s += tt = -5 * (u = Game.kills);
  scoreitem(t, tt, '%d stars destroyed', u);

  s += tt = -150 * (u = Game.killinhab);
  scoreitem(t, tt, '%d inhabited starsystems destroyed', u);

  if (Ship.ship !== ENTERPRISE) {
    s -= 200;
    scoreitem(t, -200, 'penalty for abandoning ship');
  }

  s += tt = 3 * (u = Game.captives);
  scoreitem(t, tt, '%d Klingons captured', u);

  s += tt = -(u = Game.deaths);
  scoreitem(t, tt, '%d casualties', u);

  t.io.printf('\n');
  scoreitem(t, s, '***  TOTAL');
  return s;
}
