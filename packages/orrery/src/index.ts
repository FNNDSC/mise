/**
 * @file orrery: the model of the heavens a surface draws.
 *
 * Three layers, each kept to itself: `layout/` computes where things stand
 * (pure, no renderer), `draw/` shows them, `controls/` steers the view. A
 * surface hands in a graph and an encoding and knows nothing of the rest;
 * orrery knows nothing of what the graph's nodes stand for.
 *
 * @module
 */
export * from './layout/index.js';
export type { NodeState } from './types/encoding.js';
export * from './draw/index.js';
export * from './controls/index.js';
