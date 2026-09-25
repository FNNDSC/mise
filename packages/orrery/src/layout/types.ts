/**
 * @file The layout layer's vocabulary: a point in the space, the physics a
 * settle honours, and the contract every layout engine keeps.
 *
 * Nothing here knows what a node stands for. A surface translates its own
 * domain into these shapes; an engine answers with positions.
 *
 * @module
 */

import type { Positions, Vec3 } from '../types/space.js';

export type { Positions, Vec3 };

/**
 * The terms a settle honours.
 *
 * @property charge - Nodes repel, heavier ones harder.
 * @property link - An edge holds its ends at the sum of their radii.
 * @property collide - Nodes do not overlap.
 * @property gravity - A mass-weighted pull to the centre.
 * @property reach - How far a node's repulsion carries; unbounded when
 *   absent. A sparse graph settles as wide as its charge carries, so a
 *   bounded reach lets a small molecule hug itself while a crowd spreads.
 */
export interface PhysicsTerms {
  charge: boolean;
  link: boolean;
  collide: boolean;
  gravity: boolean;
  reach?: number;
}

/** The terms a settle takes when nobody says otherwise. */
export const PHYSICS_DEFAULT: PhysicsTerms = { charge: true, link: true, collide: true, gravity: false };

/** The radius a node's size is scaled against. */
export const NODE_RADIUS: number = 0.55;

/**
 * One node an engine places.
 *
 * @property id - Its id.
 * @property parents - Its parents' ids, joins included.
 * @property radius - The room it takes.
 * @property group - The molecule it belongs to, or null for a node that
 *   stands alone (an anchor).
 * @property seed - Where it stood last, if anywhere.
 * @property frozen - Holds still at its seed.
 * @property attrs - What an engine that `needs` more reads: plugins, data
 *   kind, creation time — whatever the surface supplied.
 */
export interface LayoutNode {
  id: string;
  parents: string[];
  radius: number;
  group: string | null;
  seed?: Vec3;
  frozen?: boolean;
  attrs?: Record<string, number | string | string[]>;
}

/** What an engine is given. */
export interface LayoutInput {
  nodes: LayoutNode[];
  physics: PhysicsTerms;
}

/** What an engine answers: every node's place, and optionally when each arrived. */
export interface LayoutResult {
  positions: Positions;
  /** The moment each node joined, for a replay; absent for a layout with no history. */
  arrival?: Record<string, number>;
}

/**
 * A layout engine: a pure function of its input, run off the page.
 *
 * @property id - Its name on the LAYOUT block and in `layout <id>`.
 * @property label - What the block shows.
 * @property needs - Node attributes it reads; an engine whose needs the
 *   surface cannot meet is offered greyed, with the reason, never run.
 * @property run - Places every node, telling `progress` how far it has come.
 */
export interface LayoutEngine {
  id: string;
  label: string;
  needs: ReadonlyArray<string>;
  run(input: LayoutInput, progress: (fraction: number) => void): LayoutResult;
}
