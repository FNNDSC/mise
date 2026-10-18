/*
 * main.ts: a TypeScript port of BSD trek(6), from main.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): main.c 1.23 2011/08/29.
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
 * @file The game's entry: the banner, then games until the captain asks
 * for no more. setjmp(env) is the catch of TrekReset; exit() the catch of
 * TrekExit.
 *
 * Deviation: the random seed, fast mode and trace come in as options
 * rather than from time(NULL) and the command line.
 *
 * C version by Eric P. Allman 5/76 (U.C. Berkeley) with help from Jeff
 * Poskanzer and Pete Rubinstein; the full credits are kept in main.c of
 * the original and reproduced in this package's NOTICE.
 *
 * @module
 */
import type { Trek } from './context.js';
import { getynpar } from './getpar.js';
import { TrekExit, TrekReset } from './io.js';
import { play } from './play.js';
import { setup } from './setup.js';

/** How a game is started: the C's command line. */
export interface TrekOptions {
  /** Etc.fast: 0 slow (-s), 1 default, 2 and up with -f. */
  fast: number;
  /** Trace: on with -t. */
  trace: number;
}

/** main(): the exit status the game ends with. */
export async function trek_main(t: Trek, options: TrekOptions): Promise<number> {
  // Default to fast mode
  t.s.Etc.fast = options.fast;
  t.s.Trace = options.trace;

  t.io.printf('\n   * * *   S T A R   T R E K   * * *\n\nPress return to continue.\n');

  let reset: boolean = false;
  while (true) {
    try {
      if (reset) {
        reset = false;
        if (!(await getynpar(t, 'Another game'))) t.io.exit(0);
      }
      do {
        await setup(t);
        await play(t);
      } while (await getynpar(t, 'Another game'));
      t.io.fflush();
      return 0;
    } catch (caught: unknown) {
      if (caught instanceof TrekReset) {
        reset = true;
        continue;
      }
      if (caught instanceof TrekExit) return caught.code;
      throw caught;
    }
  }
}
