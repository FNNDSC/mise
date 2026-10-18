/*
 * srscan.ts: a TypeScript port of BSD trek(6), from srscan.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): srscan.c 1.11 2009/08/12.
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
 * @file The short range sensor scan of the current quadrant, with the
 * status report beside it, as the original prints them.
 *
 * @module
 */
import { LIFESUP, NSECTS, Q_DISTRESSED, SHIELD, SRSCAN } from './consts.js';
import type { Trek } from './context.js';
import { check_out } from './check_out.js';
import { damaged } from './damaged.js';
import { getynpar, testnl, type Cvntab } from './getpar.js';
import { Lentab, Skitab } from './setup.js';
import type { Quad } from './state.js';
import { systemname } from './systemname.js';

/** The condition names, by Ship.cond. */
const Color: ReadonlyArray<string> = ['GREEN', 'DOCKED', 'YELLOW', 'RED'];

/**
 * Takes a short range sensor scan of the current quadrant, with a status report beside it.
 *
 * SHORT RANGE SENSOR SCAN
 *
 * A short range scan is taken of the current quadrant.  If the
 * flag 'f' is one, it is an "auto srscan", which is not done
 * unless in 'fast' mode.  It does a status report and a srscan.
 * If 'f' is -1, you get a status report only.  If it is zero,
 * you get a srscan and an optional status report.  The status
 * report is taken if you enter "srscan yes"; for all srscans
 * thereafter you get a status report with your srscan until
 * you type "srscan no".  It defaults to on.
 *
 * The current quadrant is filled in on the computer chart.
 *
 * C: `srscan()` in srscan.c.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param f - 1 for an auto scan (fast mode only), 0 for a scan with an optional status report, -1 for a status report only.
 */
export async function srscan(t: Trek, f: number): Promise<void> {
  let statinfo: number;
  let s: string;
  let percent: number;
  let q: Quad | null = null;
  let p: Cvntab;

  if (f >= 0 && check_out(t, SRSCAN)) {
    return;
  }
  if (f) {
    statinfo = 1;
  } else {
    if (!(await testnl(t))) t.s.Etc.statreport = await getynpar(t, 'status report');
    statinfo = t.s.Etc.statreport;
  }
  if (f > 0) {
    t.s.Etc.statreport = 1;
    if (!t.s.Etc.fast) return;
  }
  if (f >= 0) {
    t.io.printf('\nShort range sensor scan\n');
    q = t.s.Quad[t.s.Ship.quadx][t.s.Ship.quady];
    q.scanned = q.klings * 100 + q.bases * 10 + q.stars;
    t.io.printf('  ');
    for (let i: number = 0; i < NSECTS; i++) {
      t.io.printf('%d ', i);
    }
    t.io.printf('\n');
  }

  for (let i: number = 0; i < NSECTS; i++) {
    if (f >= 0) {
      t.io.printf('%d ', i);
      for (let j: number = 0; j < NSECTS; j++) t.io.printf('%c ', t.s.Sect[i][j]);
      t.io.printf('%d', i);
      if (statinfo) t.io.printf('   ');
    }
    if (statinfo) {
      switch (i) {
        case 0:
          t.io.printf('stardate      %.2f', t.s.Now.date);
          break;
        case 1:
          t.io.printf('condition     %s', Color[t.s.Ship.cond]);
          if (t.s.Ship.cloaked) t.io.printf(', CLOAKED');
          break;
        case 2:
          t.io.printf('position      %d,%d/%d,%d', t.s.Ship.quadx, t.s.Ship.quady, t.s.Ship.sectx, t.s.Ship.secty);
          break;
        case 3:
          t.io.printf('warp factor   %.1f', t.s.Ship.warp);
          break;
        case 4:
          t.io.printf('total energy  %d', t.s.Ship.energy);
          break;
        case 5:
          t.io.printf('torpedoes     %d', t.s.Ship.torped);
          break;
        case 6:
          s = 'down';
          if (t.s.Ship.shldup) s = 'up';
          if (damaged(t, SHIELD)) s = 'damaged';
          percent = Math.trunc(100.0 * t.s.Ship.shield / t.s.Param.shield);
          t.io.printf('shields       %s, %d%%', s, percent);
          break;
        case 7:
          t.io.printf('Klingons left %d', t.s.Now.klings);
          break;
        case 8:
          t.io.printf('time left     %.2f', t.s.Now.time);
          break;
        case 9:
          t.io.printf('life support  ');
          if (damaged(t, LIFESUP)) {
            t.io.printf('damaged, reserves = %.2f', t.s.Ship.reserves);
            break;
          }
          t.io.printf('active');
          break;
      }
    }
    t.io.printf('\n');
  }
  if (f < 0) {
    t.io.printf('current crew  %d\n', t.s.Ship.crew);
    t.io.printf('brig space    %d\n', t.s.Ship.brigfree);
    t.io.printf('Klingon power %d\n', t.s.Param.klingpwr);
    let n: number = t.s.Game.length - 1;
    if (t.s.Game.length > 2) n--;
    p = Lentab[n] as Cvntab;
    t.io.printf('Length, Skill %s%s, ', p.abbrev, p.full);
    p = Skitab[t.s.Game.skill - 1] as Cvntab;
    t.io.printf('%s%s\n', p.abbrev, p.full);
    return;
  }
  t.io.printf('  ');
  for (let i: number = 0; i < NSECTS; i++) t.io.printf('%d ', i);
  t.io.printf('\n');

  // q is set: f >= 0 here
  const here: Quad = q as Quad;
  if (here.qsystemname & Q_DISTRESSED) t.io.printf('Distressed ');
  if (here.qsystemname) t.io.printf('Starsystem %s\n', systemname(t, here) ?? '(null)');
}
