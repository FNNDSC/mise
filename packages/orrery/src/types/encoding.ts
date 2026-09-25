/**
 * @file What a surface tells orrery about a node, beyond where it stands.
 *
 * @module
 */

/**
 * A node's state, as orrery draws it: resting, at work, finished well, or
 * failed. A surface maps its own statuses onto these four; when a tube
 * streams or replays, and when a stage blinks or lamps, is orrery's rule
 * keyed off this alone.
 */
export type NodeState = 'rest' | 'live' | 'done' | 'failed';

/** A colour of the palette a surface hands in, named rather than given. */
export type PaletteToken = 'running' | 'done' | 'error' | 'template' | 'unknown' | 'root';

/**
 * How a node is coloured, named rather than given, so a theme change
 * repaints it: one of the palette's colours; a hue the surface assigns (a
 * mode's colour); or a blend of two palette colours by a share, 0..1.
 */
export type Paint =
  | { token: PaletteToken }
  | { hue: string }
  | { blend: [PaletteToken, PaletteToken]; share: number };

/**
 * What a surface says about a node's look, beyond where it stands.
 *
 * @property state - What orrery's rules (streams, blinks, lamps) key off.
 * @property paint - Its colour.
 * @property ember - It carries failure: under stars it is drawn as an ember,
 *   red over the glow, never lost in it.
 * @property waved - The finish wave passes through it (a stage that has
 *   finished, or one never run); a wave waits at one that has not.
 */
export interface NodeLook {
  state: NodeState;
  paint: Paint;
  ember: boolean;
  waved: boolean;
}
