/*
 * kill.ts: a TypeScript port of BSD trek(6), from kill.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): kill.c 1.11 2009/05/24.
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
 * @file The killing off of almost anything: a Klingon, a starbase, an
 * inhabited starsystem, a distress call.
 *
 * @module
 */
import { DOCKED, E_ENSLV, E_GHOST, E_KATSB, E_KDESB, E_REPRO, EMPTY, MAXEVENTS, Q_DISTRESSED, Q_SYSTEM, SSRADIO, Systemname, TOOLARGE } from './consts.js';
import type { Trek } from './context.js';
import { damaged } from './damaged.js';
import { undock } from './dock.js';
import { schedule, unschedule } from './schedule.js';
import type { Quad, TrekEvent, XY } from './state.js';
import { systemname } from './systemname.js';
import { win } from './win.js';

/*
**  KILL KILL KILL !!!
**
**	This file handles the killing off of almost anything.
*/

/*
**  Handle a Klingon's death
**
**	The Klingon at the sector given by the parameters is killed
**	and removed from the Klingon list.  Notice that it is not
**	removed from the event list; this is done later, when the
**	the event is to be caught.  Also, the time left is recomputed,
**	and the game is won if that was the last klingon.
*/

/** Handle a Klingon's death. */
export async function killk(t: Trek, ix: number, iy: number): Promise<void> {
  const { Now, Sect, Quad, Ship, Game, Etc } = t.s;
  t.io.printf('   *** Klingon at %d,%d destroyed ***\n', ix, iy);

  /* remove the scoundrel */
  Now.klings -= 1;
  Sect[ix][iy] = EMPTY;
  Quad[Ship.quadx][Ship.quady].klings -= 1;
  /* %%% IS THIS SAFE???? %%% */
  Quad[Ship.quadx][Ship.quady].scanned -= 100;
  Game.killk += 1;

  /* find the Klingon in the Klingon list */
  for (let i: number = 0; i < Etc.nkling; i++) {
    if (ix === Etc.klingon[i].x && iy === Etc.klingon[i].y) {
      /* purge him from the list */
      Etc.nkling -= 1;
      for (; i < Etc.nkling; i++) Etc.klingon[i] = { ...Etc.klingon[i + 1] };
      break;
    }
  }

  /* find out if that was the last one */
  if (Now.klings <= 0) await win(t);

  /* recompute time left */
  Now.time = Now.resource / Now.klings;
}

/*
**  handle a starbase's death
*/

/** Handle a starbase's death. */
export async function killb(t: Trek, qx: number, qy: number): Promise<void> {
  const { Now, Sect, Ship, Etc } = t.s;
  const q: Quad = t.s.Quad[qx][qy];

  if (q.bases <= 0) return;
  if (!damaged(t, SSRADIO)) {
    /* then update starchart */
    if (q.scanned < 1000) q.scanned -= 10;
    else if (q.scanned > 1000) q.scanned = -1;
  }
  q.bases = 0;
  Now.bases -= 1;
  let b: number;
  for (b = 0; ; b++) {
    if (qx === Now.base[b].x && qy === Now.base[b].y) break;
  }
  const last: XY = Now.base[Now.bases];
  Now.base[b] = { ...last };
  if (qx === Ship.quadx && qy === Ship.quady) {
    Sect[Etc.starbase.x][Etc.starbase.y] = EMPTY;
    if (Ship.cond === DOCKED) await undock(t, 0);
    t.io.printf('Starbase at %d,%d destroyed\n', Etc.starbase.x, Etc.starbase.y);
  } else {
    if (!damaged(t, SSRADIO)) {
      t.io.printf('Uhura: Starfleet command reports that the starbase in\n');
      t.io.printf('   quadrant %d,%d has been destroyed\n', qx, qy);
    } else {
      schedule(t, E_KATSB | E_GHOST, TOOLARGE, qx, qy, 0);
    }
  }
}

/**
 **	kill an inhabited starsystem
 **
 ** x, y are quad coords if f == 0, else sector coords
 ** f != 0 -- this quad;  f < 0 -- Enterprise's fault
 **/

/** Kill an inhabited starsystem. */
export async function kills(t: Trek, x: number, y: number, f: number): Promise<void> {
  const { Ship, Game } = t.s;
  let q: Quad;

  if (f) {
    /* current quadrant */
    q = t.s.Quad[Ship.quadx][Ship.quady];
    t.s.Sect[x][y] = EMPTY;
    const name: string | null = systemname(t, q);
    if (name === null) return;
    t.io.printf('Inhabited starsystem %s at %d,%d destroyed\n', name, x, y);
    if (f < 0) Game.killinhab += 1;
  } else {
    /* different quadrant */
    q = t.s.Quad[x][y];
  }
  if (q.qsystemname & Q_DISTRESSED) {
    /* distressed starsystem */
    const e: number = q.qsystemname & Q_SYSTEM;
    t.io.printf('Distress call for %s invalidated\n', Systemname[t.s.Event[e].systemname]);
    unschedule(t, e);
  }
  q.qsystemname = 0;
  q.stars -= 1;
}

/**
 **	"kill" a distress call
 **
 ** x, y are quadrant coordinates
 ** f is set if user is to be informed
 **/

/** "Kill" a distress call. */
export async function killd(t: Trek, x: number, y: number, f: number): Promise<void> {
  const q: Quad = t.s.Quad[x][y];
  for (let i: number = 0; i < MAXEVENTS; i++) {
    const e: TrekEvent = t.s.Event[i];
    if (e.x !== x || e.y !== y) continue;
    switch (e.evcode) {
      case E_KDESB:
        if (f) {
          t.io.printf('Distress call for starbase in %d,%d nullified\n', x, y);
          unschedule(t, i);
        }
        break;

      case E_ENSLV:
      case E_REPRO:
        if (f) {
          t.io.printf('Distress call for %s in quadrant %d,%d nullified\n', Systemname[e.systemname], x, y);
          q.qsystemname = e.systemname;
          unschedule(t, i);
        } else {
          e.evcode |= E_GHOST;
        }
    }
  }
}
