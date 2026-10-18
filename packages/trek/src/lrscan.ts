/*
 * lrscan.ts: a TypeScript port of BSD trek(6), from lrscan.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): lrscan.c 1.10 2009/05/24.
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
 * @file The long range scan: the eight quadrants around the ship and its
 * own, each as klingons, bases and stars in one three-digit number.
 *
 * @module
 */
import { LRSCAN, NQUADS } from './consts.js';
import type { Trek } from './context.js';
import { check_out } from './check_out.js';
import type { Quad } from './state.js';

/**
 * Prints the long range scan of the quadrants around the ship.
 *
 * LONG RANGE OF SCANNERS
 *
 * A summary of the quadrants that surround you is printed.  The
 * hundreds digit is the number of Klingons in the quadrant,
 * the tens digit is the number of starbases, and the units digit
 * is the number of stars.  If the printout is "///" it means
 * that that quadrant is rendered uninhabitable by a supernova.
 * It also updates the "scanned" field of the quadrants it scans,
 * for future use by the "chart" option of the computer.
 *
 * C: `lrscan()` in lrscan.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param _v - The command table's argument, unused here.
 */
export async function lrscan(t: Trek, _v: number): Promise<void> {
  let q: Quad;

  if (check_out(t, LRSCAN)) {
    return;
  }
  t.io.printf('Long range scan for quadrant %d,%d\n\n', t.s.Ship.quadx, t.s.Ship.quady);

  /* print the header on top */
  for (let j: number = t.s.Ship.quady - 1; j <= t.s.Ship.quady + 1; j++) {
    if (j < 0 || j >= NQUADS) t.io.printf('      ');
    else t.io.printf('     %1d', j);
  }

  /* scan the quadrants */
  for (let i: number = t.s.Ship.quadx - 1; i <= t.s.Ship.quadx + 1; i++) {
    t.io.printf('\n  -------------------\n');
    if (i < 0 || i >= NQUADS) {
      /* negative energy barrier */
      t.io.printf('  !  *  !  *  !  *  !');
      continue;
    }

    /* print the left hand margin */
    t.io.printf('%1d !', i);
    for (let j: number = t.s.Ship.quady - 1; j <= t.s.Ship.quady + 1; j++) {
      if (j < 0 || j >= NQUADS) {
        /* negative energy barrier again */
        t.io.printf('  *  !');
        continue;
      }
      q = t.s.Quad[i][j];
      if (q.stars < 0) {
        /* supernova */
        t.io.printf(' /// !');
        q.scanned = 1000;
        continue;
      }
      q.scanned = q.klings * 100 + q.bases * 10 + q.stars;
      t.io.printf(' %3d !', q.scanned);
    }
  }
  t.io.printf('\n  -------------------\n');
  return;
}
