/*
 * dumpgame.ts: a TypeScript port of BSD trek(6), from dumpgame.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): dumpgame.c 1.15 2009/08/12.
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
 * @file Dumping the game for a later restart, and restarting it.
 *
 * Deviation: the C writes the data areas to the file "trek.dump" in the
 * current directory; here they are kept in the session's dump slot
 * (`t.dump`), so `dump` then a `restart` length restores the game within
 * the session. The version check stays.
 *
 * @module
 */
import type { Trek } from './context.js';
import type { Etc, Game, Move, Now, Param, Quad, Ship, TrekEvent, TrekState } from './state.js';

/** THIS CONSTANT MUST CHANGE AS THE DATA SPACES CHANGE */
const VERSION: number = 2;

/** The data areas, in the C's Dump_template order. */
interface Dump {
  version: number;
  Ship: Ship;
  Now: Now;
  Param: Param;
  Etc: Etc;
  Game: Game;
  Sect: string[][];
  Quad: Quad[][];
  Move: Move;
  Event: TrekEvent[];
}

/** DUMP GAME */
export async function dumpgame(t: Trek, _v: number): Promise<void> {
  const { Ship, Now, Param, Etc, Game, Sect, Quad, Move, Event } = t.s;
  const dump: Dump = { version: VERSION, Ship, Now, Param, Etc, Game, Sect, Quad, Move, Event };
  t.dump.saved = structuredClone(dump);
}

/** RESTORE GAME: zero for success, one for failure. */
export async function restartgame(t: Trek): Promise<number> {
  const dump: Dump | null = t.dump.saved === null ? null : structuredClone(t.dump.saved as Dump);
  if (dump === null || dump.version !== VERSION) {
    t.io.printf('cannot restart\n');
    return 1;
  }
  const s: TrekState = t.s;
  // In place, as the C's read() into each area.
  Object.assign(s.Ship, dump.Ship);
  Object.assign(s.Now, dump.Now);
  Object.assign(s.Param, dump.Param);
  Object.assign(s.Etc, dump.Etc);
  Object.assign(s.Game, dump.Game);
  dump.Sect.forEach((row: string[], x: number): void => { s.Sect[x] = row; });
  dump.Quad.forEach((row: Quad[], x: number): void => row.forEach((one: Quad, y: number): void => { Object.assign((s.Quad[x] as Quad[])[y] as Quad, one); }));
  Object.assign(s.Move, dump.Move);
  dump.Event.forEach((one: TrekEvent, n: number): void => { Object.assign(s.Event[n] as TrekEvent, one); });
  return 0;
}

