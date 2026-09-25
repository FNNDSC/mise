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
