/**
 * @file How faint things are drawn: the opacities the drawers share.
 *
 * @module
 */

/** How faint a dimmed node and its edges are drawn. */
export const DIM_OPACITY: number = 0.16;

/** How faint a cluster's halo is drawn. */
export const HALO_OPACITY: number = 0.09;

/** Threads (edges) while the scene draws stars: faint, so the light leads. */
export const THREAD_OPACITY: number = 0.1;

/** A nebula's opacity at its heart; a dimmed one a third of it. */
export const NEBULA_OPACITY: number = 0.2;
