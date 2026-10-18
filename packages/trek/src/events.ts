/*
 * events.ts: a TypeScript port of BSD trek(6), from events.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): events.c 1.11 2009/05/24.
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
 * @file Causing time to elapse: energy eaten and regenerated, and every
 * event that falls due processed in date order: supernovas, tractor beams,
 * attacks on starbases, distress calls, enslavement, Klingon
 * reproduction, galaxy snapshots, attacks during a rest, and repairs.
 *
 * Deviation: the snapshot is a copy of the state (state.ts), not a block
 * of bytes.
 *
 * @module
 */
import { attack } from './attack.js';
import { compkldist } from './compkl.js';
import {
  Device, DOCKED, E_ATTACK, E_ENSLV, E_EVENT, E_FIXDV, E_GHOST, E_HIDDEN, E_ISSUE, E_KATSB, E_KDESB, E_LRTB, E_REPRO, E_SNAP,
  E_SNOVA, KLINGON, L_NOTIME, LIFESUP, MAXDISTR, MAXEVENTS, MAXKLQUAD, NQUADS, NSECTS, Q_DISTRESSED, Q_SYSTEM, SINS, SSRADIO,
  Systemname,
} from './consts.js';
import type { Trek } from './context.js';
import { damaged } from './damaged.js';
import { dumpssradio } from './dumpssradio.js';
import { getynpar } from './getpar.js';
import { initquad, sector } from './initquad.js';
import { killb } from './kill.js';
import { lose } from './lose.js';
import { franf, ranf } from './rand.js';
import { reschedule, schedule, unschedule, xresched, xsched } from './schedule.js';
import { snova } from './snova.js';
import { snapshot_take, type Kling, type Quad, type TrekEvent, type TrekState, type XY } from './state.js';

/** CAUSE TIME TO ELAPSE: 'timewarp' is set if called in a time warp. */
export async function events(t: Trek, timewarp: number): Promise<number> {
  const s: TrekState = t.s;
  const { Move, Now, Ship, Param, Etc, Game } = s;
  const quad = (x: number, y: number): Quad => (s.Quad[x] as Quad[])[y] as Quad;
  const event = (n: number): TrekEvent => s.Event[n] as TrekEvent;
  let i: number;
  let j: number = 0;
  let rtime: number;
  let xdate: number;
  let ev: number = -1;
  let ix: number = 0;
  let iy: number = 0;
  let q: Quad;
  let e: number;
  let evnum: number;
  let restcancel: number;

  // if nothing happened, just allow for any Klingons killed
  if (Move.time <= 0.0) {
    Now.time = Now.resource / Now.klings;
    return 0;
  }

  // indicate that the cloaking device is now working
  Ship.cloakgood = 1;

  // idate is the initial date
  const idate: number = Now.date;

  // schedule attacks if resting too long
  if (Move.time > 0.5 && Move.resting) schedule(t, E_ATTACK, 0.5, 0, 0, 0);

  // scan the event list
  while (true) {
    restcancel = 0;
    evnum = -1;
    // xdate is the date of the current event
    xdate = idate + Move.time;

    // find the first event that has happened
    for (i = 0; i < MAXEVENTS; i++) {
      const one: TrekEvent = event(i);
      if (one.evcode === 0 || one.evcode & E_GHOST) continue;
      if (one.date < xdate) {
        xdate = one.date;
        ev = i;
        evnum = i;
      }
    }
    e = ev;

    // find the time between events
    rtime = xdate - Now.date;

    // decrement the magic "Federation Resources" pseudo-variable
    Now.resource -= Now.klings * rtime;
    // and recompute the time left
    Now.time = Now.resource / Now.klings;

    // move us up to the next date
    Now.date = xdate;

    // check for out of time
    if (Now.time <= 0.0) await lose(t, L_NOTIME);
    if (evnum >= 0 && s.Trace) {
      const one: TrekEvent = event(e);
      t.io.printf('xdate = %.2f, evcode %d params %d %d %d\n', xdate, one.evcode, one.x, one.y, one.systemname);
    }

    // if evnum < 0, no events occurred
    if (evnum < 0) break;

    // otherwise one did.  Find out what it is
    switch (event(e).evcode & E_EVENT) {
      case E_SNOVA: // supernova
        // cause the supernova to happen
        await snova(t, -1, 0);
        // and schedule the next one
        xresched(t, e, E_SNOVA, 1);
        break;

      case E_LRTB: // long range tractor beam
        // schedule the next one
        xresched(t, e, E_LRTB, Now.klings);
        // LRTB cannot occur if we are docked
        if (Ship.cond !== DOCKED) {
          // pick a new quadrant
          i = ranf(t.rnd, Now.klings) + 1;
          for (ix = 0; ix < NQUADS; ix++) {
            for (iy = 0; iy < NQUADS; iy++) {
              q = quad(ix, iy);
              if (q.stars >= 0) if ((i -= q.klings) <= 0) break;
            }
            if (i <= 0) break;
          }

          // test for LRTB to same quadrant
          if (Ship.quadx === ix && Ship.quady === iy) break;

          // nope, dump him in the new quadrant
          Ship.quadx = ix;
          Ship.quady = iy;
          t.io.printf('\n%s caught in long range tractor beam\n', Ship.shipname);
          t.io.printf('*** Pulled to quadrant %d,%d\n', Ship.quadx, Ship.quady);
          Ship.sectx = ranf(t.rnd, NSECTS);
          Ship.secty = ranf(t.rnd, NSECTS);
          await initquad(t, 0);
          // truncate the move time
          Move.time = xdate - idate;
        }
        break;

      case E_KATSB: // Klingon attacks starbase
        // if out of bases, forget it
        if (Now.bases <= 0) {
          unschedule(t, e);
          break;
        }

        // check for starbase and Klingons in same quadrant
        for (i = 0; i < Now.bases; i++) {
          ix = (Now.base[i] as XY).x;
          iy = (Now.base[i] as XY).y;
          // see if a Klingon exists in this quadrant
          q = quad(ix, iy);
          if (q.klings <= 0) continue;

          // see if already distressed
          for (j = 0; j < MAXEVENTS; j++) {
            const one: TrekEvent = event(j);
            if ((one.evcode & E_EVENT) !== E_KDESB) continue;
            if (one.x === ix && one.y === iy) break;
          }
          if (j < MAXEVENTS) continue;

          // got a potential attack
          break;
        }
        e = ev;
        if (i >= Now.bases) {
          // not now; wait a while and see if some Klingons move in
          reschedule(t, e, 0.5 + 3.0 * franf(t.rnd));
          break;
        }
        // schedule a new attack, and a destruction of the base
        xresched(t, e, E_KATSB, 1);
        e = xsched(t, E_KDESB, 1, ix, iy, 0);

        // report it if we can
        if (!damaged(t, SSRADIO)) {
          t.io.printf('\nUhura:  Captain, we have received a distress signal\n');
          t.io.printf('  from the starbase in quadrant %d,%d.\n', ix, iy);
          restcancel++;
        } else {
          // SSRADIO out, make it so we can't see the distress call but it's still there!!!
          event(e).evcode |= E_HIDDEN;
        }
        break;

      case E_KDESB: { // Klingon destroys starbase
        unschedule(t, e);
        const one: TrekEvent = event(e);
        q = quad(one.x, one.y);
        // if the base has mysteriously gone away, or if the Klingon got tired and went home, ignore this event
        if (q.bases <= 0 || q.klings <= 0) break;
        // are we in the same quadrant?
        if (one.x === Ship.quadx && one.y === Ship.quady) {
          // yep, kill one in this quadrant
          t.io.printf('\nSpock: ');
          await killb(t, Ship.quadx, Ship.quady);
        } else {
          // kill one in some other quadrant
          await killb(t, one.x, one.y);
        }
        break;
      }

      case E_ISSUE: // issue a distress call
        xresched(t, e, E_ISSUE, 1);
        // if we already have too many, throw this one away
        if (Ship.distressed >= MAXDISTR) break;
        // try a bunch of times to find something suitable
        q = quad(0, 0);
        for (i = 0; i < 100; i++) {
          ix = ranf(t.rnd, NQUADS);
          iy = ranf(t.rnd, NQUADS);
          q = quad(ix, iy);
          // need a quadrant which is not the current one, which has some inhabited stars which are not
          // already under attack, which is not supernova'ed, and which has some Klingons in it
          if (!((ix === Ship.quadx && iy === Ship.quady) || q.stars < 0 || q.qsystemname & Q_DISTRESSED || (q.qsystemname & Q_SYSTEM) === 0 || q.klings <= 0)) break;
        }
        // can't seem to find one; ignore this call
        if (i >= 100) break;

        // got one!!  Schedule its enslavement
        Ship.distressed++;
        e = xsched(t, E_ENSLV, 1, ix, iy, q.qsystemname);
        q.qsystemname = e | Q_DISTRESSED;

        // tell the captain about it if we can
        if (!damaged(t, SSRADIO)) {
          t.io.printf('\nUhura: Captain, starsystem %s in quadrant %d,%d is under attack\n', Systemname[event(e).systemname] as string, ix, iy);
          restcancel++;
        } else {
          // if we can't tell him, make it invisible
          event(e).evcode |= E_HIDDEN;
        }
        break;

      case E_ENSLV: { // starsystem is enslaved
        unschedule(t, e);
        // see if current distress call still active
        const one: TrekEvent = event(e);
        q = quad(one.x, one.y);
        if (q.klings <= 0) {
          // no Klingons, clean up
          // restore the system name
          q.qsystemname = one.systemname;
          break;
        }

        // play stork and schedule the first baby
        e = schedule(t, E_REPRO, (Param.eventdly[E_REPRO] as number) * franf(t.rnd), one.x, one.y, one.systemname);

        // report the disaster if we can
        const baby: TrekEvent = event(e);
        if (!damaged(t, SSRADIO)) {
          t.io.printf("\nUhura:  We've lost contact with starsystem %s\n", Systemname[baby.systemname] as string);
          t.io.printf('  in quadrant %d,%d.\n', baby.x, baby.y);
        } else {
          baby.evcode |= E_HIDDEN;
        }
        break;
      }

      case E_REPRO: { // Klingon reproduces
        // see if distress call is still active
        const one: TrekEvent = event(e);
        q = quad(one.x, one.y);
        if (q.klings <= 0) {
          unschedule(t, e);
          q.qsystemname = one.systemname;
          break;
        }
        xresched(t, e, E_REPRO, 1);
        // reproduce one Klingon
        ix = one.x;
        iy = one.y;
        if (Now.klings === 127) {
          // full right now
          break;
        }
        if (q.klings >= MAXKLQUAD) {
          // this quadrant not ok, pick an adjacent one
          for (i = ix - 1; i <= ix + 1; i++) {
            if (i < 0 || i >= NQUADS) continue;
            for (j = iy - 1; j <= iy + 1; j++) {
              if (j < 0 || j >= NQUADS) continue;
              q = quad(i, j);
              // check for this quad ok (not full & no snova)
              if (q.klings >= MAXKLQUAD || q.stars < 0) continue;
              break;
            }
            if (j <= iy + 1) break;
          }
          // cannot create another yet
          if (j > iy + 1) break;
          ix = i;
          iy = j;
        }
        // deliver the child
        q.klings++;
        Now.klings++;
        if (ix === Ship.quadx && iy === Ship.quady) {
          // we must position Klingon
          const r: XY = sector(t);
          ix = r.x;
          iy = r.y;
          (s.Sect[ix] as string[])[iy] = KLINGON;
          const k: Kling = Etc.klingon[Etc.nkling++] as Kling;
          k.x = ix;
          k.y = iy;
          k.power = Param.klingpwr;
          k.srndreq = 0;
          const first: Kling = Etc.klingon[0] as Kling;
          compkldist(t, first.dist === first.avgdist ? 0 : 1);
        }

        // recompute time left
        Now.time = Now.resource / Now.klings;
        break;
      }

      case E_SNAP: // take a snapshot of the galaxy
        xresched(t, e, E_SNAP, 1);
        Etc.snapshot = snapshot_take(s);
        Game.snap = 1;
        break;

      case E_ATTACK: // Klingons attack during rest period
        if (!Move.resting) {
          unschedule(t, e);
          break;
        }
        await attack(t, 1);
        reschedule(t, e, 0.5);
        break;

      case E_FIXDV: {
        i = event(e).systemname;
        unschedule(t, e);

        // de-damage the device
        const device: Device = Device[i] as Device;
        t.io.printf('%s reports repair work on the %s finished.\n', device.person, device.name);

        // handle special processing upon fix
        switch (i) {
          case LIFESUP:
            Ship.reserves = Param.reserves;
            break;

          case SINS:
            if (Ship.cond === DOCKED) break;
            t.io.printf('Spock has tried to recalibrate your Space Internal Navigation System,\n');
            t.io.printf('  but he has no standard base to calibrate to.  Suggest you get\n');
            t.io.printf('  to a starbase immediately so that you can properly recalibrate.\n');
            Ship.sinsbad = 1;
            break;

          case SSRADIO:
            restcancel = dumpssradio(t);
            break;
        }
        break;
      }

      default:
        break;
    }

    if (restcancel && Move.resting && (await getynpar(t, 'Spock: Shall we cancel our rest period'))) Move.time = xdate - idate;
  }

  // unschedule an attack during a rest period
  if ((e = Now.eventptr[E_ATTACK] as number) !== -1) unschedule(t, e);

  if (!timewarp) {
    // eat up energy if cloaked
    if (Ship.cloaked) Ship.energy = Math.trunc(Ship.energy - Param.cloakenergy * Move.time);

    // regenerate resources
    rtime = 1.0 - Math.exp(-Param.regenfac * Move.time);
    Ship.shield = Math.trunc(Ship.shield + (Param.shield - Ship.shield) * rtime);
    Ship.energy = Math.trunc(Ship.energy + (Param.energy - Ship.energy) * rtime);

    // decrement life support reserves
    if (damaged(t, LIFESUP) && Ship.cond !== DOCKED) Ship.reserves -= Move.time;
  }
  return 0;
}
