/*
 * consts.ts: a TypeScript port of BSD trek(6), from trek.h, externs.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): trek.h 1.19 2024/02/10; externs.c 1.10 2009/05/24.
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
 * @file trek's constants: the dimensions, the sector glyphs, the devices,
 * the event codes, the ways to lose, and the tables `externs.c` defines.
 *
 * Names are the C names, so a reader can hold this beside trek.h.
 *
 * @module
 */

/** Dimensions of a quadrant in sectors. */
export const NSECTS: number = 10;
/** Dimension of the galaxy in quadrants. */
export const NQUADS: number = 8;
/** Number of quadrants which are inhabited. */
export const NINHAB: number = 32;

/** Quad.qsystemname flag: a distress call is out for this quadrant. */
export const Q_DISTRESSED: number = 0o200;
/** Quad.qsystemname mask: the starsystem's name index. */
export const Q_SYSTEM: number = 0o77;

/** Sector contents. */
export const EMPTY: string = '.';
export const STAR: string = '*';
export const BASE: string = '#';
export const ENTERPRISE: string = 'E';
export const QUEENE: string = 'Q';
export const KLINGON: string = 'K';
export const INHABIT: string = '@';
export const HOLE: string = ' ';

/** Max number of devices. */
export const NDEV: number = 16;
export const WARP: number = 0;
export const SRSCAN: number = 1;
export const LRSCAN: number = 2;
export const PHASER: number = 3;
export const TORPED: number = 4;
export const IMPULSE: number = 5;
export const SHIELD: number = 6;
export const COMPUTER: number = 7;
export const SSRADIO: number = 8;
export const LIFESUP: number = 9;
export const SINS: number = 10;
export const CLOAK: number = 11;
export const XPORTER: number = 12;
export const SHUTTLE: number = 13;

/** Number of different event types. */
export const NEVENTS: number = 12;
export const E_LRTB: number = 1;
export const E_KATSB: number = 2;
export const E_KDESB: number = 3;
export const E_ISSUE: number = 4;
export const E_ENSLV: number = 5;
export const E_REPRO: number = 6;
export const E_FIXDV: number = 7;
export const E_ATTACK: number = 8;
export const E_SNAP: number = 9;
export const E_SNOVA: number = 10;
export const E_GHOST: number = 0o100;
export const E_HIDDEN: number = 0o200;
export const E_EVENT: number = 0o77;

/** Maximum number of pending events. */
export const MAXEVENTS: number = 25;
/** Maximum Klingons per quadrant. */
export const MAXKLQUAD: number = 9;

/** Condition codes. */
export const GREEN: number = 0;
export const DOCKED: number = 1;
export const YELLOW: number = 2;
export const RED: number = 3;

/** Maximum number of starbases in the galaxy. */
export const MAXBASES: number = 9;
/** Maximum concurrent distress calls. */
export const MAXDISTR: number = 5;
/** Number of phaser banks. */
export const NBANKS: number = 6;

/** Klingon move modes. */
export const KM_OB: number = 0;
export const KM_OA: number = 1;
export const KM_EB: number = 2;
export const KM_EA: number = 3;
export const KM_LB: number = 4;
export const KM_LA: number = 5;

/** Ways to lose. */
export const L_NOTIME: number = 1;
export const L_NOENGY: number = 2;
export const L_DSTRYD: number = 3;
export const L_NEGENB: number = 4;
export const L_SUICID: number = 5;
export const L_SNOVA: number = 6;
export const L_NOLIFE: number = 7;
export const L_NOHELP: number = 8;
export const L_TOOFAST: number = 9;
export const L_STAR: number = 10;
export const L_DSTRCT: number = 11;
export const L_CAPTURED: number = 12;
export const L_NOCREW: number = 13;

/** Trace compilation option, kept as in the original. */
export const xTRACE: number = 1;

/** A number larger than any distance: DBL_MAX / 2. */
export const TOOLARGE: number = Number.MAX_VALUE / 2;

/** The random source's range, as random() returns: 0 .. RANDOM_MAX. */
export const RANDOM_MAX: number = 0x7fffffff;

/** A device and the person who fixes it. */
export interface Device {
  /** The device's name, as the crew reports it. */
  name: string;
  /** The crew member who reports on and fixes it. */
  person: string;
}

/** The devices, by index (externs.c). */
export const Device: ReadonlyArray<Device> = [
  { name: 'warp drive', person: 'Scotty' },
  { name: 'S.R. scanners', person: 'Scotty' },
  { name: 'L.R. scanners', person: 'Scotty' },
  { name: 'phasers', person: 'Sulu' },
  { name: 'photon tubes', person: 'Sulu' },
  { name: 'impulse engines', person: 'Scotty' },
  { name: 'shield control', person: 'Sulu' },
  { name: 'computer', person: 'Spock' },
  { name: 'subspace radio', person: 'Uhura' },
  { name: 'life support', person: 'Scotty' },
  { name: 'navigation system', person: 'Chekov' },
  { name: 'cloaking device', person: 'Scotty' },
  { name: 'transporter', person: 'Scotty' },
  { name: 'shuttlecraft', person: 'Scotty' },
  { name: '*ERR 14*', person: 'Nobody' },
  { name: '*ERR 15*', person: 'Nobody' },
];

/** The inhabited starsystems' names, by index; 0 is the error entry (externs.c). */
export const Systemname: ReadonlyArray<string> = [
  'ERROR', 'Talos IV', 'Rigel III', 'Deneb VII', 'Canopus V', 'Icarus I', 'Prometheus II', 'Omega VII',
  'Elysium I', 'Scalos IV', 'Procyon IV', 'Arachnid I', 'Argo VIII', 'Triad III', 'Echo IV', 'Nimrod III',
  'Nemisis IV', 'Centarurus I', 'Kronos III', 'Spectros V', 'Beta III', 'Gamma Tranguli VI', 'Pyris III', 'Triachus',
  'Marcus XII', 'Kaland', 'Ardana', 'Stratos', 'Eden', 'Arrikis', 'Epsilon Eridani IV', 'Exo III',
];
