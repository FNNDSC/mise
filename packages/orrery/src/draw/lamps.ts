/**
 * @file The lamps a replayed or running stage wears: how dark it rests, how its glow blooms, how the lot dims before the run replays.
 *
 * @module
 */

import * as THREE from 'three';

/** A replayed stage before its pulse lands: this share of its colour. */
export const LAMP_DIM: number = 0.18;

/** How long a stage's glow blooms out and settles as its pulse lands. */
export const LAMP_BLOOM_MS: number = 1000;

/** How far the bloom reaches, in the stage's radii. */
export const LAMP_BLOOM_REACH: number = 9;

/** How long the lit stages take to dim before the run replays. */
export const LAMP_FADE_MS: number = 500;

/** What a lit stage brightens toward. */
export const LAMP_WHITE: THREE.Color = new THREE.Color('#ffffff');
