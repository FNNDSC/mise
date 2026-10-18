/*
 * computer.ts: a TypeScript port of BSD trek(6), from computer.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): computer.c 1.16 2009/08/12.
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
 * @file The on-board computer: star chart, Klingon trajectories, course
 * computation (and the move along it), score, phaser effectiveness, warp
 * and impulse costs, and the list of distress calls.
 *
 * Deviation: the C's request table carries its case number cast into the
 * function slot; here a parallel table holds it.
 *
 * @module
 */
import { COMPUTER, E_ENSLV, E_EVENT, E_HIDDEN, E_KDESB, E_REPRO, MAXEVENTS, NQUADS, NSECTS, SRSCAN, Systemname } from './consts.js';
import type { Trek } from './context.js';
import { check_out } from './check_out.js';
import { getcodpar, getfltpar, getintpar, readdelim, type Cvntab } from './getpar.js';
import { EOF } from './io.js';
import { score } from './score.js';
import type { Quad, TrekEvent } from './state.js';
import { warp } from './warp.js';

/*
**  On-Board Computer
**
**	A computer request is fetched from the captain.  The requests
**	are:
**
**	chart -- print a star chart of the known galaxy.  This includes
**		every quadrant that has ever had a long range or
**		a short range scan done of it, plus the location of
**		all starbases.  This is of course updated by any sub-
**		space radio broadcasts (unless the radio is out).
**		The format is the same as that of a long range scan
**		except that ".1." indicates that a starbase exists
**		but we know nothing else.
**
**	trajectory -- gives the course and distance to every know
**		Klingon in the quadrant.  Obviously this fails if the
**		short range scanners are out.
**
**	course -- gives a course computation from whereever you are
**		to any specified location.  If the course begins
**		with a slash, the current quadrant is taken.
**		Otherwise the input is quadrant and sector coordi-
**		nates of the target sector.
**
**	move -- identical to course, except that the move is performed.
**
**	score -- prints out the current score.
**
**	pheff -- "PHaser EFFectiveness" at a given distance.  Tells
**		you how much stuff you need to make it work.
**
**	warpcost -- Gives you the cost in time and units to move for
**		a given distance under a given warp speed.
**
**	impcost -- Same for the impulse engines.
**
**	distresslist -- Gives a list of the currently known starsystems
**		or starbases which are distressed, together with their
**		quadrant coordinates.
**
**	If a command is terminated with a semicolon, you remain in
**	the computer; otherwise, you escape immediately to the main
**	command processor.
*/

/** The request table. */
const Cputab: ReadonlyArray<Cvntab> = [
  { abbrev: 'ch', full: 'art', value: null, value2: 0 },
  { abbrev: 't', full: 'rajectory', value: null, value2: 0 },
  { abbrev: 'c', full: 'ourse', value: null, value2: 0 },
  { abbrev: 'm', full: 'ove', value: null, value2: 1 },
  { abbrev: 's', full: 'core', value: null, value2: 0 },
  { abbrev: 'p', full: 'heff', value: null, value2: 0 },
  { abbrev: 'w', full: 'arpcost', value: null, value2: 0 },
  { abbrev: 'i', full: 'mpcost', value: null, value2: 0 },
  { abbrev: 'd', full: 'istresslist', value: null, value2: 0 },
];

/** The C's `(cmdfun)N` of each Cputab entry, in table order. */
const CPUCASE: ReadonlyArray<number> = [1, 2, 3, 3, 4, 5, 6, 7, 8];

/** On-board computer. */
export async function computer(t: Trek, _v: number): Promise<void> {
  const { Ship, Etc, Param } = t.s;
  let ix: number;
  let iy: number;
  let i: number;
  let j: number;
  let tqx: number;
  let tqy: number;
  let cost: number;
  let course: number;
  let dist: number;
  let time: number;
  let warpfact: number;

  if (check_out(t, COMPUTER)) return;
  while (true) {
    const r: Cvntab = await getcodpar(t, '\nRequest', Cputab);
    request: switch (CPUCASE[Cputab.indexOf(r)]) {
      case 1 /* star chart */:
        t.io.printf('Computer record of galaxy for all long range sensor scans\n\n');
        t.io.printf('  ');
        /* print top header */
        for (i = 0; i < NQUADS; i++) t.io.printf('-%d- ', i);
        t.io.printf('\n');
        for (i = 0; i < NQUADS; i++) {
          t.io.printf('%d ', i);
          for (j = 0; j < NQUADS; j++) {
            if (i === Ship.quadx && j === Ship.quady) {
              t.io.printf('$$$ ');
              continue;
            }
            const q: Quad = t.s.Quad[i][j];
            /* 1000 or 1001 is special case */
            if (q.scanned >= 1000) {
              if (q.scanned > 1000) t.io.printf('.1. ');
              else t.io.printf('/// ');
            } else if (q.scanned < 0) {
              t.io.printf('... ');
            } else {
              t.io.printf('%3d ', q.scanned);
            }
          }
          t.io.printf('%d\n', i);
        }
        t.io.printf('  ');
        /* print bottom footer */
        for (i = 0; i < NQUADS; i++) t.io.printf('-%d- ', i);
        t.io.printf('\n');
        break;

      case 2 /* trajectory */:
        if (check_out(t, SRSCAN)) {
          break;
        }
        if (Etc.nkling <= 0) {
          t.io.printf('No Klingons in this quadrant\n');
          break;
        }
        /* for each Klingon, give the course & distance */
        for (i = 0; i < Etc.nkling; i++) {
          t.io.printf('Klingon at %d,%d', Etc.klingon[i].x, Etc.klingon[i].y);
          // as the C: the ship's quadrant is passed as the target quadrant
          const calc: CourseCalc = kalc(t, Ship.quadx, Ship.quady, Etc.klingon[i].x, Etc.klingon[i].y);
          prkalc(t, calc.course, calc.dist);
        }
        break;

      case 3 /* course calculation */: {
        if (await readdelim(t, 47)) {
          tqx = Ship.quadx;
          tqy = Ship.quady;
        } else {
          ix = await getintpar(t, 'Quadrant');
          if (ix < 0 || ix >= NSECTS) break request;
          iy = await getintpar(t, 'q-y');
          if (iy < 0 || iy >= NSECTS) break request;
          tqx = ix;
          tqy = iy;
        }
        ix = await getintpar(t, 'Sector');
        if (ix < 0 || ix >= NSECTS) break;
        iy = await getintpar(t, 's-y');
        if (iy < 0 || iy >= NSECTS) break;
        const calc: CourseCalc = kalc(t, tqx, tqy, ix, iy);
        course = calc.course;
        dist = calc.dist;
        if (r.value2) {
          await warp(t, -1, course, dist);
          break;
        }
        t.io.printf('%d,%d/%d,%d to %d,%d/%d,%d', Ship.quadx, Ship.quady, Ship.sectx, Ship.secty, tqx, tqy, ix, iy);
        prkalc(t, course, dist);
        break;
      }

      case 4 /* score */:
        score(t);
        break;

      case 5 /* phaser effectiveness */:
        dist = await getfltpar(t, 'range');
        if (dist < 0.0) break;
        dist *= 10.0;
        cost = Math.trunc(Math.pow(0.90, dist) * 98.0 + 0.5);
        t.io.printf('Phasers are %d%% effective at that range\n', cost);
        break;

      case 6 /* warp cost (time/energy) */:
        dist = await getfltpar(t, 'distance');
        if (dist < 0.0) break;
        warpfact = await getfltpar(t, 'warp factor');
        if (warpfact <= 0.0) warpfact = Ship.warp;
        cost = Math.trunc((dist + 0.05) * warpfact * warpfact * warpfact);
        time = (Param.warptime * dist) / (warpfact * warpfact);
        t.io.printf('Warp %.2f distance %.2f cost %.2f stardates %d (%d w/ shlds up) units\n', warpfact, dist, time, cost, cost + cost);
        break;

      case 7 /* impulse cost */:
        dist = await getfltpar(t, 'distance');
        if (dist < 0.0) break;
        cost = Math.trunc(20 + 100 * dist);
        time = dist / 0.095;
        t.io.printf('Distance %.2f cost %.2f stardates %d units\n', dist, time, cost);
        break;

      case 8 /* distresslist */:
        j = 1;
        t.io.printf('\n');
        /* scan the event list */
        for (i = 0; i < MAXEVENTS; i++) {
          const e: TrekEvent = t.s.Event[i];
          /* ignore hidden entries */
          if (e.evcode & E_HIDDEN) continue;
          switch (e.evcode & E_EVENT) {
            case E_KDESB:
              t.io.printf('Klingon is attacking starbase in quadrant %d,%d\n', e.x, e.y);
              j = 0;
              break;

            case E_ENSLV:
            case E_REPRO:
              t.io.printf('Starsystem %s in quadrant %d,%d is distressed\n', Systemname[e.systemname], e.x, e.y);
              j = 0;
              break;
          }
        }
        if (j) t.io.printf('No known distress calls are active\n');
        break;
    }

    /*
     * Skip to next semicolon or newline.  Semicolon
     * means get new computer request; newline means
     * exit computer mode.
     */
    while ((i = await t.io.getchar()) !== 59) {
      if (i === EOF) t.io.exit(1);
      if (i === 10) {
        t.io.ungetc(i);
        return;
      }
    }
  }
}

/*
**  Course Calculation
**
**	Computes and outputs the course and distance from position
**	sqx,sqy/ssx,ssy to tqx,tqy/tsx,tsy.
*/

/** A course and a distance, as kalc works them out. */
interface CourseCalc {
  /** The course, in degrees. */
  course: number;
  /** The distance, in quadrants. */
  dist: number;
}

/** Course calculation: the course (the C's return) and the distance (its out-parameter). */
function kalc(t: Trek, tqx: number, tqy: number, tsx: number, tsy: number): CourseCalc {
  const { Ship } = t.s;
  let dx: number;

  /* normalize to quadrant distances */
  const quadsize: number = NSECTS;
  dx = Ship.quadx + Ship.sectx / quadsize - (tqx + tsx / quadsize);
  const dy: number = tqy + tsy / quadsize - (Ship.quady + Ship.secty / quadsize);

  /* get the angle */
  let angle: number = Math.atan2(dy, dx);
  /* make it 0 -> 2 pi */
  if (angle < 0.0) angle += 6.283185307;
  /* convert from radians to degrees */
  const course: number = Math.trunc(angle * 57.29577951 + 0.5);
  dx = dx * dx + dy * dy;
  return { course, dist: Math.sqrt(dx) };
}

/** Prints a course and distance. */
function prkalc(t: Trek, course: number, dist: number): void {
  t.io.printf(': course %d  dist %.3f\n', course, dist);
}
