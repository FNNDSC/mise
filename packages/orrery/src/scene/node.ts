/**
 * @file One node as the orrery draws it.
 *
 * The scene's vocabulary for a node, held apart from the scene so the parts
 * the scene composes (the settle, the wave, the grab, the hover) can name
 * it without reaching into the scene.
 */
import type { NodeLook } from '../types/encoding.js';

/** One node as the orrery draws it; a surface's own node type extends this. */
export interface SpaceNode {
  id: string;
  label: string;
  /**
   * What an engine that needs more reads (`LayoutEngine.needs`): a stage's
   * plugin, a star's kind — whatever the surface supplies.
   */
  attrs?: Record<string, number | string | string[]>;
  /** Words pinned above the node, read without hovering (a hub's name and count). */
  caption?: string;
  /** Drawn as a ringed star: a node of another kind among the stars (a plugin in constellations). */
  ring?: boolean;
  /** How it looks, read by the surface from its own domain. */
  look: NodeLook;
  parentIds: string[];
  joinParentIds: string[];
  /** Scalar for molecule radius scaling; undefined = degree fallback. */
  metric?: number;
  /** Collapsed-group multiplicity (×N); undefined or 1 for singletons. */
  count?: number;
  /**
   * A ghost drawn as a halo: a translucent sphere at the anchor's place,
   * sized by `count`, that names a cluster on hover and takes a click
   * when no solid sphere is under the pointer. Never edged.
   */
  halo?: boolean;
  /**
   * Drawn as a lit sphere even when the scene draws stars: a node the
   * operator is at (an entered feed's own nodes) stays solid to hover and
   * press, whatever its size on screen.
   */
  solid?: boolean;
  /**
   * Joined to its parent by a tube whatever the draw mode: a node of a
   * graph whose paths are the point (a feed's view), drawn as a star under
   * stars yet still tubed. Without it, under stars only solid nodes are.
   */
  tubed?: boolean;
  /**
   * Drawn faint: the rest of a field while one part of it is entered.
   * Present in the settle and drawn, but at a fraction of its opacity, and
   * its edges with it.
   */
  dim?: boolean;
  /**
   * Present in the settle, never drawn: an anchor that pulls its children
   * together (the universe hangs feeds of one shape from one), with no
   * sphere, no edge and no pick of its own.
   */
  ghost?: boolean;
  /**
   * Its joins are drawn faint — a thread at a dim node's strength, never a
   * tube — for a relation that is not an edge of the run (a feed's lineage
   * to the feed it began from).
   */
  joinFaint?: boolean;
}
