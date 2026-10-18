/*
 * abandon.ts: a TypeScript port of BSD trek(6), from abandon.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): abandon.c 1.9 2009/05/24.
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
 * @file Abandoning ship: the officers escape, the crew beams down or is
 * lost, and the captain is exchanged into the Fairie Queene, or captured.
 *
 * @module
 */
import { CLOAK, DOCKED, E_FIXDV, EMPTY, GREEN, L_CAPTURED, MAXEVENTS, NDEV, NSECTS, QUEENE, SHUTTLE, XPORTER } from './consts.js';
import type { Trek } from './context.js';
import { compkldist } from './compkl.js';
import { damaged } from './damaged.js';
import { dock } from './dock.js';
import { initquad } from './initquad.js';
import { lose } from './lose.js';
import { out } from './out.js';
import { ranf } from './rand.js';
import { unschedule } from './schedule.js';
import type { Quad, TrekEvent, XY } from './state.js';
import { systemname } from './systemname.js';

/**
 * Abandons ship: the officers escape, the crew beams down or is lost, and the captain takes the Faire Queene or is captured.
 *
 * Abandon Ship
 *
 * The ship is abandoned.  If your current ship is the Faire
 * Queene, or if your shuttlecraft is dead, you're out of
 * luck.  You need the shuttlecraft in order for the captain
 * (that's you!!) to escape.
 *
 * Your crew can beam to an inhabited starsystem in the
 * quadrant, if there is one and if the transporter is working.
 * If there is no inhabited starsystem, or if the transporter
 * is out, they are left to die in outer space.
 *
 * These currently just count as regular deaths, but they
 * should count very heavily against you.
 *
 * If there are no starbases left, you are captured by the
 * Klingons, who torture you mercilessly.  However, if there
 * is at least one starbase, you are returned to the
 * Federation in a prisoner of war exchange.  Of course, this
 * can't happen unless you have taken some prisoners.
 *
 * Uses trace flag 40
 *
 * C: `abandon()` in abandon.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param _v - The command table value, unused.
 */
export async function abandon(t: Trek, _v: number): Promise<void> {
  let i: number;

  if (t.s.Ship.ship === QUEENE) {
    t.io.printf('You may not abandon ye Faire Queene\n');
    return;
  }
  if (t.s.Ship.cond !== DOCKED) {
    if (damaged(t, SHUTTLE)) {
      await out(t, SHUTTLE);
      return;
    }
    t.io.printf('Officers escape in shuttlecraft\n');
    /* decide on fate of crew */
    const q: Quad = t.s.Quad[t.s.Ship.quadx][t.s.Ship.quady];
    if (q.qsystemname === 0 || damaged(t, XPORTER)) {
      t.io.printf('Entire crew of %d left to die in outer space\n', t.s.Ship.crew);
      t.s.Game.deaths += t.s.Ship.crew;
    } else {
      t.io.printf('Crew beams down to planet %s\n', systemname(t, q) ?? '(null)');
    }
  }
  /* see if you can be exchanged */
  if (t.s.Now.bases === 0 || t.s.Game.captives < 20 * t.s.Game.skill) await lose(t, L_CAPTURED);
  /* re-outfit new ship */
  t.io.printf('You are hereby put in charge of an antiquated but still\n');
  t.io.printf('  functional ship, the Fairie Queene.\n');
  t.s.Ship.ship = QUEENE;
  t.s.Ship.shipname = 'Fairie Queene';
  t.s.Param.energy = t.s.Ship.energy = 3000;
  t.s.Param.torped = t.s.Ship.torped = 6;
  t.s.Param.shield = t.s.Ship.shield = 1250;
  t.s.Ship.shldup = 0;
  t.s.Ship.cloaked = 0;
  t.s.Ship.warp = 5.0;
  t.s.Ship.warp2 = 25.0;
  t.s.Ship.warp3 = 125.0;
  t.s.Ship.cond = GREEN;
  /* clear out damages on old ship */
  for (i = 0; i < MAXEVENTS; i++) {
    const e: TrekEvent = t.s.Event[i] as TrekEvent;
    if (e.evcode !== E_FIXDV) continue;
    unschedule(t, i);
  }
  /* get rid of some devices and redistribute probabilities */
  const damprob: number[] = t.s.Param.damprob;
  i = (damprob[SHUTTLE] as number) + (damprob[CLOAK] as number);
  damprob[SHUTTLE] = damprob[CLOAK] = 0;
  while (i > 0) {
    for (let j: number = 0; j < NDEV; j++) {
      if (damprob[j] !== 0) {
        damprob[j] = (damprob[j] as number) + 1;
        i--;
        if (i <= 0) break;
      }
    }
  }
  /* pick a starbase to restart at */
  i = ranf(t.rnd, t.s.Now.bases);
  const base: XY = t.s.Now.base[i] as XY;
  t.s.Ship.quadx = base.x;
  t.s.Ship.quady = base.y;
  /* setup that quadrant */
  while (true) {
    await initquad(t, 1);
    t.s.Sect[t.s.Ship.sectx][t.s.Ship.secty] = EMPTY;
    for (i = 0; i < 5; i++) {
      t.s.Ship.sectx = t.s.Etc.starbase.x + ranf(t.rnd, 3) - 1;
      if (t.s.Ship.sectx < 0 || t.s.Ship.sectx >= NSECTS) continue;
      t.s.Ship.secty = t.s.Etc.starbase.y + ranf(t.rnd, 3) - 1;
      if (t.s.Ship.secty < 0 || t.s.Ship.secty >= NSECTS) continue;
      if (t.s.Sect[t.s.Ship.sectx][t.s.Ship.secty] === EMPTY) {
        t.s.Sect[t.s.Ship.sectx][t.s.Ship.secty] = QUEENE;
        await dock(t, 0);
        compkldist(t, 0);
        return;
      }
    }
  }
}
