/**
 * @file When a molecule turns from stars to spheres and back, and how long the crossfade takes.
 *
 * @module
 */

/** A feed switches to solid when its largest sphere spans this many CSS pixels… */
export const HANDOFF_SOLID_PX: number = 7;

/** …and back to stars below this: the gap keeps a feed at the edge from flickering. */
export const HANDOFF_STAR_PX: number = 5;

/** The crossfade between a feed's stars and its spheres. */
export const HANDOFF_FADE_MS: number = 300;
