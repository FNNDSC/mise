/*
 * systemname.ts: a TypeScript port of BSD trek(6), from systemname.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): systemname.c 1.9 2009/05/25.
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
 * @file The name of a quadrant's starsystem, knowing about distressed
 * systems (whose name is held by the distress event).
 *
 * @module
 */
import type { Trek } from './context.js';
import { Q_DISTRESSED, Q_SYSTEM, Systemname } from './consts.js';
import type { Quad, TrekEvent } from './state.js';

/**
 * Gets the name of a quadrant's starsystem.
 *
 * RETRIEVE THE STARSYSTEM NAME. A distressed system's name is held by its
 * distress event.
 *
 * C: `systemname()` in systemname.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param q - The quadrant.
 * @returns The starsystem's name, or null when the quadrant has none (the C's NULL).
 */
export function systemname(t: Trek, q: Quad): string | null {
  let i: number = q.qsystemname;
  if (i & Q_DISTRESSED) i = (t.s.Event[i & Q_SYSTEM] as TrekEvent).systemname;
  i &= Q_SYSTEM;
  if (i === 0) return null;
  return Systemname[i] as string;
}
