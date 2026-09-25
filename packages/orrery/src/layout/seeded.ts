/**
 * @file Chance that comes out the same every time.
 *
 * A layout that turns each molecule at random, so like feeds do not stand
 * as clones, still owes the operator the same space on every device and
 * every visit. The turn is seeded by the molecule itself — a hash of its
 * key — so it is fixed for that molecule, and a molecule arriving later
 * turns no other.
 *
 * @module
 */

/**
 * A 32-bit FNV-1a hash of a string.
 *
 * @param text - What to hash.
 * @returns The hash, an unsigned 32-bit integer.
 */
export function hash_of(text: string): number {
  let hash: number = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A seeded source of numbers in [0, 1): a linear congruential generator.
 *
 * @param seed - The seed.
 * @returns The next number each time it is called.
 */
export function random_seeded(seed: number): () => number {
  let state: number = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * The source a molecule draws its chance from: seeded by its own key.
 *
 * @param key - The molecule's key (its group).
 * @returns A source that runs the same way every time for that key.
 */
export function randomFor_key(key: string): () => number {
  return random_seeded(hash_of(key));
}
