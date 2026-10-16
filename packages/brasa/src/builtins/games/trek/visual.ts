/*
 * visual.ts: a TypeScript port of BSD trek(6), from visual.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): visual.c 1.10 2009/08/12.
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
 * @file The visual scan: three sectors in the direction asked, for when
 * the sensors are out.
 *
 * @module
 */
import { NSECTS } from './consts.js';
import type { Trek } from './context.js';
import { getintpar } from './getpar.js';
import type { XY } from './state.js';

/*
**  VISUAL SCAN
**
**	A visual scan is made in a particular direction of three sectors
**	in the general direction specified.  This takes time, and
**	Klingons can attack you, so it should be done only when sensors
**	are out.
*/

/* This struct[] has the delta x, delta y for particular directions */
// As compiled: struct xy holds unsigned chars, so the C's -1 is stored as 255 and those
// directions look off the edge ('?'). Kept, so the scan reads as the original's does.
const Visdelta: ReadonlyArray<XY> = [
  { x: 255, y: 255 },
  { x: 255, y: 0 },
  { x: 255, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 0 },
  { x: 1, y: 255 },
  { x: 0, y: 255 },
  { x: 255, y: 255 },
  { x: 255, y: 0 },
  { x: 255, y: 1 },
];

/** The sector at a delta from the ship: its character, or '?' off the edge. */
function look(t: Trek, v: XY): { ix: number; iy: number; co: string } {
  const ix: number = t.s.Ship.sectx + v.x;
  const iy: number = t.s.Ship.secty + v.y;
  const co: string = ix < 0 || ix >= NSECTS || iy < 0 || iy >= NSECTS ? '?' : t.s.Sect[ix][iy];
  return { ix, iy, co };
}

/** VISUAL SCAN */
export async function visual(t: Trek, _z: number): Promise<void> {
  let co: number = await getintpar(t, 'direction');
  if (co < 0 || co > 360) return;
  co = Math.trunc((co + 22) / 45);
  const a = look(t, Visdelta[co] as XY);
  t.io.printf('%d,%d %c ', a.ix, a.iy, a.co);
  const b = look(t, Visdelta[co + 1] as XY);
  t.io.printf('%c ', b.co);
  const c = look(t, Visdelta[co + 2] as XY);
  t.io.printf('%c %d,%d\n', c.co, c.ix, c.iy);
  t.s.Move.time = 0.05;
  t.s.Move.free = 0;
}
