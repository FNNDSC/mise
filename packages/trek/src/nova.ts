/*
 * nova.ts: a TypeScript port of BSD trek(6), from nova.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): nova.c 1.8 2009/05/24.
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
 * @file A nova: a star hit by a photon torpedo may fail, go nova, turn
 * into a black hole or go supernova; a nova takes its neighbours with it.
 *
 * Deviation: a starbase caught in a nova is the one in this quadrant; the
 * C passed the sector coordinates to killb() as a quadrant's.
 *
 * @module
 */
import { BASE, EMPTY, ENTERPRISE, HOLE, INHABIT, KLINGON, L_SUICID, NSECTS, QUEENE, STAR } from './consts.js';
import type { Trek } from './context.js';
import { killb, killk, kills } from './kill.js';
import { lose } from './lose.js';
import { ranf } from './rand.js';
import { snova } from './snova.js';

/*
**  CAUSE A NOVA TO OCCUR
**
**	A nova occurs.  It is the result of having a star hit with
**	a photon torpedo.  There are several things which may happen.
**	The star may not be affected.  It may go nova.  It may turn
**	into a black hole.  Any (yummy) it may go supernova.
**
**	Stars that go nova cause stars which surround them to undergo
**	the same probabilistic process.  Klingons next to them are
**	destroyed.  And if the starship is next to it, it gets zapped.
**	If the zap is too much, it gets destroyed.
*/

/** Cause a nova to occur. */
export async function nova(t: Trek, x: number, y: number): Promise<void> {
  const { Sect, Quad, Ship, Game } = t.s;

  if (Sect[x][y] !== STAR || Quad[Ship.quadx][Ship.quady].stars < 0) return;
  if (ranf(t.rnd, 100) < 15) {
    t.io.printf('Spock: Star at %d,%d failed to nova.\n', x, y);
    return;
  }
  if (ranf(t.rnd, 100) < 5) {
    await snova(t, x, y);
    return;
  }
  t.io.printf('Spock: Star at %d,%d gone nova\n', x, y);

  if (ranf(t.rnd, 4) !== 0) {
    Sect[x][y] = EMPTY;
  } else {
    Sect[x][y] = HOLE;
    Quad[Ship.quadx][Ship.quady].holes += 1;
  }
  Quad[Ship.quadx][Ship.quady].stars -= 1;
  Game.kills += 1;
  for (let i: number = x - 1; i <= x + 1; i++) {
    if (i < 0 || i >= NSECTS) continue;
    for (let j: number = y - 1; j <= y + 1; j++) {
      if (j < 0 || j >= NSECTS) continue;
      const se: string = Sect[i][j];
      switch (se) {
        case EMPTY:
        case HOLE:
          break;

        case KLINGON:
          await killk(t, i, j);
          break;

        case STAR:
          await nova(t, i, j);
          break;

        case INHABIT:
          await kills(t, i, j, -1);
          break;

        case BASE:
          // Deviation: the C passes the sector (i, j) as a quadrant, reading past Quad (a crash, or a
          // stray base killed); the base hit is the one in this quadrant.
          await killb(t, Ship.quadx, Ship.quady);
          Game.killb += 1;
          break;

        case ENTERPRISE:
        case QUEENE: {
          let zap: number = 2000;
          if (Ship.shldup) {
            if (Ship.shield >= zap) {
              Ship.shield -= zap;
              zap = 0;
            } else {
              zap -= Ship.shield;
              Ship.shield = 0;
            }
          }
          Ship.energy -= zap;
          if (Ship.energy <= 0) await lose(t, L_SUICID);
          break;
        }

        default:
          t.io.printf('Unknown object %c at %d,%d destroyed\n', se, i, j);
          Sect[i][j] = EMPTY;
          break;
      }
    }
  }
}
