/*
 * check_out.ts: a TypeScript port of BSD trek(6), from check_out.c.
 * Ported from NetBSD src/games/trek (trunk 7a9ca154a8f6144307865f23390a3c63b400b801): check_out.c 1.6 2009/05/24.
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
 * @file Whether a device is really out: broken, and no starbase to lend
 * its own.
 *
 * @module
 */
import { Device, DOCKED } from './consts.js';
import type { Trek } from './context.js';
import { damaged } from './damaged.js';
import { out } from './out.js';

/*
**  CHECK IF A DEVICE IS OUT
**
**	The indicated device is checked to see if it is disabled.  If
**	it is, an attempt is made to use the starbase device.  If both
**	of these fails, it returns non-zero (device is REALLY out),
**	otherwise it returns zero (I can get to it somehow).
**
**	It prints appropriate messages too.
*/

/** CHECK IF A DEVICE IS OUT */
export function check_out(t: Trek, device: number): number {
  const dev: number = device;

  /* check for device ok */
  if (!damaged(t, dev)) return 0;

  /* report it as being dead */
  // out() only prints: its body runs to completion on the call, so nothing is lost by not awaiting it
  void out(t, dev);

  /* but if we are docked, we can go ahead anyhow */
  if (t.s.Ship.cond !== DOCKED) return 1;
  t.io.printf('  Using starbase %s\n', (Device[dev] as Device).name);
  return 0;
}
