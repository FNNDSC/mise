/**
 * @file Who made trek: the game's authors, the port, and where the port
 * comes from.
 *
 * One text, shown by `trek --credits` in a terminal and in mise's session,
 * and by the `credits` command in the game.
 * The game's credits follow the C's own, in main.c.
 *
 * @module
 */
import type { Trek } from './context.js';

/** What `trek --credits` says, ending in a newline. */
export const TREK_CREDITS: string = [
  'bsd-trek: BSD trek(6), the 1976 Berkeley trek game, in TypeScript.',
  '',
  'The game',
  '  C version by Eric P. Allman, 1976 (U.C. Berkeley), with help from',
  '  Jeff Poskanzer and Pete Rubinstein, and thanks to Nick Whyte, who',
  '  suggested the name for the "capture" command.',
  '  From the FORTRAN version by Kay R. Fisher (DEC), itself from the BASIC',
  '  game by Mike Mayfield (Centerline Engineering), with more from the',
  '  FORTRAN version by David Matuszek and Paul Reynolds and the Battelle',
  '  Version 7A by Joe Miller and Ross Pavlac.',
  '  Kept in NetBSD\'s games collection, whose sources this port follows.',
  '',
  'The port',
  '  Ported line for line to TypeScript by Rudolph Pienaar, 2026, as part',
  '  of mise.',
  '',
  'mise',
  '  A web shell over a backend: a kernel of commands, a terminal shell',
  '  (chell) and a browser surface (ARGUS), built first for ChRIS. The',
  '  same engine plays as `trek` in both.',
  '  https://github.com/FNNDSC/mise',
  '',
  'ChRIS',
  '  An open-source platform for medical image computing, from the',
  '  Fetal-Neonatal Neuroimaging and Developmental Science Center at Boston',
  '  Children\'s Hospital: it runs analyses as containers on any compute,',
  '  from a laptop to the cloud.',
  '  https://chrisproject.org',
  '',
  'Star Trek is a trademark of Paramount; this is an unaffiliated port of a',
  '1976 public game.',
  '',
].join('\n');

/**
 * Shows who made the game, at the Command: prompt.
 *
 * A command the port added, last in the command table so the C's own come first when `?` lists them. It takes no time: the move stays free, so no stardate passes and the Klingons do not act.
 *
 * @param t - The game: state, terminal and random numbers.
 * @param _v - The command table's argument, unused here.
 */
export async function credits_show(t: Trek, _v: number): Promise<void> {
  t.io.printf('\n%s', TREK_CREDITS);
}
