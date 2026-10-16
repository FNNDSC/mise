/*
 * checkcond.ts: a TypeScript port of BSD trek(6), from checkcond.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): checkcond.c 1.7 2009/05/24.
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
 * @file The ship's condition after a move: lost for want of life support,
 * energy or crew; burnt in a supernova; else green, yellow or red.
 *
 * @module
 */
import { DOCKED, GREEN, L_NOCREW, L_NOENGY, L_NOLIFE, L_SNOVA, RED, YELLOW } from './consts.js';
import type { Trek } from './context.js';
import { autover } from './autover.js';
import { killd } from './kill.js';
import { lose } from './lose.js';

/*
**  Check for Condition After a Move
**
**	Various ship conditions are checked.  First we check
**	to see if we have already lost the game, due to running
**	out of life support reserves, running out of energy,
**	or running out of crew members.  The check for running
**	out of time is in events().
**
**	If we are in automatic override mode (Etc.nkling < 0), we
**	don't want to do anything else, lest we call autover
**	recursively.
**
**	In the normal case, if there is a supernova, we call
**	autover() to help us escape.  If after calling autover()
**	we are still in the grips of a supernova, we get burnt
**	up.
**
**	If there are no Klingons in this quadrant, we nullify any
**	distress calls which might exist.
**
**	We then set the condition code, based on the energy level
**	and battle conditions.
*/

/** Check for Condition After a Move */
export async function checkcond(t: Trek): Promise<void> {
  /* see if we are still alive and well */
  if (t.s.Ship.reserves < 0.0) await lose(t, L_NOLIFE);
  if (t.s.Ship.energy <= 0) await lose(t, L_NOENGY);
  if (t.s.Ship.crew <= 0) await lose(t, L_NOCREW);
  /* if in auto override mode, ignore the rest */
  if (t.s.Etc.nkling < 0) return;
  /* call in automatic override if appropriate */
  if (t.s.Quad[t.s.Ship.quadx][t.s.Ship.quady].stars < 0) await autover(t);
  if (t.s.Quad[t.s.Ship.quadx][t.s.Ship.quady].stars < 0) await lose(t, L_SNOVA);
  /* nullify distress call if appropriate */
  if (t.s.Etc.nkling <= 0) await killd(t, t.s.Ship.quadx, t.s.Ship.quady, 1);

  /* set condition code */
  if (t.s.Ship.cond === DOCKED) return;

  if (t.s.Etc.nkling > 0) {
    t.s.Ship.cond = RED;
    return;
  }
  if (t.s.Ship.energy < t.s.Param.energylow) {
    t.s.Ship.cond = YELLOW;
    return;
  }
  t.s.Ship.cond = GREEN;
  return;
}
