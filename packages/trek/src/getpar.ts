/*
 * getpar.ts: a TypeScript port of BSD trek(6), from getpar.c, getpar.h.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): getpar.c 1.18 2009/08/12; getpar.h 1.12 2009/05/25.
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
 * @file Reading a parameter: an integer, a double, yes or no, a code from a
 * table, a string; and the stream tests the rest of the game reads with.
 *
 * As the C: a prompt is printed only when the next character is a
 * newline, so parameters typed ahead on the command line are taken
 * without being asked for.
 *
 * @module
 */
import type { CmdFun, Trek } from './context.js';
import { EOF, type Scanned } from './io.js';

/** One entry of a conversion table: an abbreviation, the rest of the word, what it does, a value. */
export interface Cvntab {
  /** The letters that must be typed. */
  abbrev: string;
  /** The rest of the word, which may be typed in part. */
  full: string;
  /** The command it runs, or null in a table of plain values. */
  value: CmdFun | null;
  /** A number passed with it (the yes/no answer, a command's argument). */
  value2: number;
}

/**
 * Reads an integer, prompting when the next character is a newline.
 *
 * get integer parameter
 *
 * C: `getintpar()` in getpar.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param s - The prompt, or null for none.
 * @returns The integer typed.
 */
export async function getintpar(t: Trek, s: string | null): Promise<number> {
  while (true) {
    if ((await testnl(t)) && s) t.io.printf('%s: ', s);
    const read: Scanned<number> = await t.io.int_scan();
    if (read.count < 0) t.io.exit(1);
    if (read.count > 0 && (await testterm(t))) return read.value;
    t.io.printf('invalid input; please enter an integer\n');
    await skiptonl(t, 0);
  }
}

/**
 * Reads a double, prompting when the next character is a newline.
 *
 * get floating parameter
 *
 * C: `getfltpar()` in getpar.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param s - The prompt, or null for none.
 * @returns The double typed.
 */
export async function getfltpar(t: Trek, s: string | null): Promise<number> {
  while (true) {
    if ((await testnl(t)) && s) t.io.printf('%s: ', s);
    const read: Scanned<number> = await t.io.double_scan();
    if (read.count < 0) t.io.exit(1);
    if (read.count > 0 && (await testterm(t))) return read.value;
    t.io.printf('invalid input; please enter a double\n');
    await skiptonl(t, 0);
  }
}

/** The yes/no table. */
const Yntab: ReadonlyArray<Cvntab> = [
  { abbrev: 'y', full: 'es', value: null, value2: 1 },
  { abbrev: 'n', full: 'o', value: null, value2: 0 },
];

/**
 * Reads a yes or no answer.
 *
 * get yes/no parameter
 *
 * C: `getynpar()` in getpar.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param s - The prompt.
 * @returns 1 for yes, 0 for no.
 */
export async function getynpar(t: Trek, s: string): Promise<number> {
  const r: Cvntab = await getcodpar(t, s, Yntab);
  return r.value2;
}

/**
 * Reads a word and finds it in a table.
 *
 * get coded parameter: a word matched against a table by its abbreviation
 * and as much of the rest as was typed; `?` lists the table.
 *
 * C: `getcodpar()` in getpar.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param s - The prompt.
 * @param tab - The table of words to match against.
 * @returns The table entry matched.
 */
export async function getcodpar(t: Trek, s: string, tab: ReadonlyArray<Cvntab>): Promise<Cvntab> {
  let flag: boolean = false;
  while (true) {
    const f: boolean = await testnl(t);
    flag = flag || f;
    if (flag) t.io.printf('%s: ', s);
    if (f) {
      // throw out the newline
      await t.io.getchar();
    }
    await t.io.chars_skip(' \t;');
    const read: Scanned<string> = await t.io.text_scanUntil(' \t;\n', 99);
    if (read.count < 0) t.io.exit(1);
    if (read.count === 0) continue;
    flag = true;
    const input: string = read.value;
    // if command list, print four per line
    if (input === '?') {
      let c: number = 4;
      for (const r of tab) {
        t.io.printf('%14.14s', r.abbrev + r.full);
        if (--c > 0) continue;
        c = 4;
        t.io.printf('\n');
      }
      if (c !== 4) t.io.printf('\n');
      continue;
    }
    // search for in table
    const found: Cvntab | undefined = tab.find((r: Cvntab): boolean => {
      if (!input.startsWith(r.abbrev)) return false;
      return abbreviationRest_match(input.slice(r.abbrev.length), r.full);
    });
    // check for not found
    if (found === undefined) {
      t.io.printf('invalid input; ? for valid inputs\n');
      await skiptonl(t, 0);
    } else {
      return found;
    }
  }
}

/**
 * Matches what was typed after the abbreviation against the rest of the word.
 *
 * The C's match of what follows the abbreviation: characters compared
 * while both last; a match when either runs out first (so a word typed
 * past the table's spelling still matches, as in the original).
 *
 * C: the inner loop of `getcodpar()` in getpar.c.
 *
 * @param rest - What was typed after the abbreviation.
 * @param full - The table's rest of the word.
 * @returns Whether they match.
 */
function abbreviationRest_match(rest: string, full: string): boolean {
  let i: number = 0;
  while (i < rest.length && i < full.length) {
    if (rest[i] !== full[i]) return false;
    i++;
  }
  return true;
}

/**
 * Reads a string, prompting when the next character is a newline.
 *
 * get string parameter: up to l characters, ended by any of t (default white space and ;).
 *
 * C: `getstrpar()` in getpar.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param s - The prompt, or null for none.
 * @param l - At most this many characters.
 * @param terminators - The characters that end it, or null for white space and `;`.
 * @returns The string typed.
 */
export async function getstrpar(t: Trek, s: string | null, l: number, terminators: string | null): Promise<string> {
  const stop: string = terminators ?? ' \t\n;';
  while (true) {
    const f: boolean = await testnl(t);
    if (f && s) t.io.printf('%s: ', s);
    if (f) await t.io.getchar();
    await t.io.chars_skip('\t ;');
    const read: Scanned<string> = await t.io.text_scanUntil(stop, l);
    if (read.count < 0) t.io.exit(1);
    if (read.count !== 0) return read.value;
  }
}

/**
 * Tests whether a newline comes before the next character that could start a parameter.
 *
 * test if newline is next valid character
 *
 * C: `testnl()` in getpar.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @returns Whether the newline is next (it is left unread either way).
 */
export async function testnl(t: Trek): Promise<boolean> {
  let c: number;
  while ((c = await t.io.getchar()) !== 10) {
    if (c === EOF) t.io.exit(1);
    if ((c >= 48 && c <= 57) || c === 46 || c === 33 || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45) {
      t.io.ungetc(c);
      return false;
    }
  }
  t.io.ungetc(c);
  return true;
}

/**
 * Throws away input up to the next newline, which is left unread.
 *
 * scan for newline
 *
 * C: `skiptonl()` in getpar.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param c - The character already read (10 when it is the newline).
 */
export async function skiptonl(t: Trek, c: number): Promise<void> {
  while (c !== 10) {
    c = await t.io.getchar();
    if (c === EOF) t.io.exit(1);
  }
  t.io.ungetc(10);
}

/**
 * Tests that what follows a number ends it.
 *
 * test for valid terminator
 *
 * C: `testterm()` in getpar.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @returns Whether the next character is a valid terminator.
 */
async function testterm(t: Trek): Promise<boolean> {
  const c: number = await t.io.getchar();
  if (c === EOF) t.io.exit(1);
  if (c === 46) return false;
  if (c === 10 || c === 59) t.io.ungetc(c);
  return true;
}

/**
 * Reads past a given delimiter if it is next, spaces aside.
 *
 * TEST FOR SPECIFIED DELIMITER: the input is scanned for the delimiter;
 * found, it is thrown away and true is returned; not found, false.
 *
 * C: `readdelim()` in getpar.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param d - The delimiter's character code.
 * @returns Whether the delimiter was found.
 */
export async function readdelim(t: Trek, d: number): Promise<boolean> {
  let c: number;
  while ((c = await t.io.getchar()) !== EOF) {
    if (c === d) return true;
    if (c === 32) continue;
    t.io.ungetc(c);
    return false;
  }
  return t.io.exit(1);
}
