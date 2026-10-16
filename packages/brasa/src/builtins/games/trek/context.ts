/**
 * @file One game of trek: its state, its terminal and its random source,
 * handed to every routine as `t` (the C kept all three global).
 *
 * @module
 */
import type { TrekIO } from './io.js';
import type { TrekRandom } from './rand.js';
import type { TrekState } from './state.js';

/** One game. */
export interface Trek {
  /** The game's state (the C's globals). */
  s: TrekState;
  /** Its terminal. */
  io: TrekIO;
  /** Its random source. */
  rnd: TrekRandom;
  /** Where `dump` keeps a game for `restart`: the C's trek.dump file, held by the session. */
  dump: TrekDump;
}

/** The saved game slot. */
export interface TrekDump {
  /** The saved game, or null when none was dumped. */
  saved: object | null;
}

/** A command routine, as Comtab and the other conversion tables hold them: `void f(int)` in C. */
export type CmdFun = (t: Trek, v: number) => Promise<void>;
