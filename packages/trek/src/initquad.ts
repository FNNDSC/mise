/*
 * initquad.ts: a TypeScript port of BSD trek(6), from initquad.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): initquad.c 1.7 2009/05/24.
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
 * @file Entering a quadrant: its contents laid out at random from what the
 * Quad matrix holds, the starship in its fixed sector; and the choice of
 * an empty sector.
 *
 * @module
 */
import type { Trek } from './context.js';
import { BASE, COMPUTER, EMPTY, HOLE, INHABIT, KLINGON, NSECTS, RED, STAR } from './consts.js';
import { compkldist } from './compkl.js';
import { damaged } from './damaged.js';
import { ranf } from './rand.js';
import { shield } from './shield.js';
import type { Kling, Quad, XY } from './state.js';

/**
 * Paramize Quadrant Upon Entering. With Klingons present the captain is
 * told the condition is RED and offered the shields. The flag `f`
 * disables that check, for when you are about to be docked.
 */
export async function initquad(t: Trek, f: number): Promise<void> {
  const q: Quad = (t.s.Quad[t.s.Ship.quadx] as Quad[])[t.s.Ship.quady] as Quad;
  // ignored supernova'ed quadrants (this is checked again later anyway
  if (q.stars < 0) return;
  t.s.Etc.nkling = q.klings;
  const nbases: number = q.bases;
  let nstars: number = q.stars;
  const nholes: number = q.holes;

  // have we blundered into a battle zone w/ shields down?
  if (t.s.Etc.nkling > 0 && !f) {
    t.io.printf('Condition RED\n');
    t.s.Ship.cond = RED;
    if (!damaged(t, COMPUTER)) await shield(t, 1);
  }

  // clear out the quadrant
  for (let i: number = 0; i < NSECTS; i++) for (let j: number = 0; j < NSECTS; j++) (t.s.Sect[i] as string[])[j] = EMPTY;

  // initialize Enterprise
  (t.s.Sect[t.s.Ship.sectx] as string[])[t.s.Ship.secty] = t.s.Ship.ship;

  // initialize Klingons
  for (let i: number = 0; i < t.s.Etc.nkling; i++) {
    const r: XY = sector(t);
    (t.s.Sect[r.x] as string[])[r.y] = KLINGON;
    const k: Kling = t.s.Etc.klingon[i] as Kling;
    k.x = r.x;
    k.y = r.y;
    k.power = t.s.Param.klingpwr;
    k.srndreq = 0;
  }
  compkldist(t, 1);

  // initialize star base
  if (nbases > 0) {
    const r: XY = sector(t);
    (t.s.Sect[r.x] as string[])[r.y] = BASE;
    t.s.Etc.starbase.x = r.x;
    t.s.Etc.starbase.y = r.y;
  }

  // initialize inhabited starsystem
  if (q.qsystemname !== 0) {
    const r: XY = sector(t);
    (t.s.Sect[r.x] as string[])[r.y] = INHABIT;
    nstars -= 1;
  }

  // initialize black holes
  for (let i: number = 0; i < nholes; i++) {
    const r: XY = sector(t);
    (t.s.Sect[r.x] as string[])[r.y] = HOLE;
  }

  // initialize stars
  for (let i: number = 0; i < nstars; i++) {
    const r: XY = sector(t);
    (t.s.Sect[r.x] as string[])[r.y] = STAR;
  }
  t.s.Move.newquad = 1;
}

/** An empty sector, chosen at random. */
export function sector(t: Trek): XY {
  let i: number;
  let j: number;
  do {
    i = ranf(t.rnd, NSECTS);
    j = ranf(t.rnd, NSECTS);
  } while ((t.s.Sect[i] as string[])[j] !== EMPTY);
  return { x: i, y: j };
}
