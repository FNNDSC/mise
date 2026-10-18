/*
 * rand.ts: a TypeScript port of BSD trek(6), from ranf.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): ranf.c 1.7 2009/05/25.
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
 * @file trek's random source: ranf() and franf() over random().
 *
 * random() is glibc's, reproduced exactly (the additive feedback generator
 * of degree 31, seeded as srandom() seeds it), so a game played here from a
 * seed is the game the C plays from the same seed: the port is checked
 * against the original, transcript for transcript.
 *
 * @module
 */
import { RANDOM_MAX } from './consts.js';

/**
 * glibc's random(), from a seed.
 *
 * The additive feedback generator of degree 31 (TYPE_3), the source every
 * ranf() and franf() in the game draws from.
 *
 * Port: stands in for C's random() and srandom().
 */
export class TrekRandom {
  /** The 31-word state table. */
  private table: number[] = [];
  /** Index of the front pointer into the table. */
  private front: number = 0;
  /** Index of the rear pointer into the table. */
  private rear: number = 0;

  /**
   * Builds a generator seeded as srandom() seeds it.
   *
   * @param seed - As srandom() takes it.
   */
  constructor(seed: number) {
    this.srandom(seed);
  }

  /**
   * Seeds the generator as glibc's srandom (TYPE_3, degree 31, separation 3).
   *
   * Port: stands in for C's srandom().
   *
   * @param seed - The seed, as srandom() takes it.
   */
  public srandom(seed: number): void {
    let word: number = seed | 0;
    if (word === 0) word = 1;
    const state: number[] = new Array<number>(31);
    state[0] = word;
    for (let i: number = 1; i < 31; i++) {
      // 16807 * state[i-1] % 2147483647, by Schrage's method, as glibc does.
      const hi: number = Math.trunc(word / 127773);
      const lo: number = word % 127773;
      word = 16807 * lo - 2836 * hi;
      if (word < 0) word += 2147483647;
      state[i] = word;
    }
    this.table = state;
    this.front = 3;
    this.rear = 0;
    // glibc discards the first 310 outputs.
    for (let i: number = 0; i < 310; i++) this.random();
  }

  /**
   * Draws the next value, 0 .. RANDOM_MAX.
   *
   * Port: stands in for C's random().
   *
   * @returns The next value of the sequence.
   */
  public random(): number {
    const sum: number = ((this.table[this.front] as number) + (this.table[this.rear] as number)) | 0;
    this.table[this.front] = sum;
    const result: number = (sum >>> 1) & RANDOM_MAX;
    this.front = (this.front + 1) % 31;
    this.rear = (this.rear + 1) % 31;
    return result;
  }
}

/**
 * Draws a random integer, 0 .. max-1 (0 when max <= 0).
 *
 * C: `ranf()` in ranf.c.
 *
 * @param rnd - The random source.
 * @param max - The exclusive upper bound.
 * @returns The integer.
 */
export function ranf(rnd: TrekRandom, max: number): number {
  if (max <= 0) return 0;
  return rnd.random() % max;
}

/**
 * Draws a random double, 0 .. 1.
 *
 * C: `franf()` in ranf.c.
 *
 * @param rnd - The random source.
 * @returns The double.
 */
export function franf(rnd: TrekRandom): number {
  return rnd.random() / RANDOM_MAX;
}
