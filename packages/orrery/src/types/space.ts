/**
 * @file The space's shared vocabulary: what every layer may name.
 *
 * A point, and where a set of nodes stands. The layers keep apart, but they
 * speak of the same space; these words are the only thing they share.
 *
 * @module
 */

/** A point in the space. */
export type Vec3 = [number, number, number];

/** Where every node stands, by id. */
export type Positions = Record<string, Vec3>;
