/**
 * @file A count with its noun, in the number the count calls for.
 *
 * A readout knows how many things it has before it prints them, so it
 * never has to hedge with `feed(s)` or `quer(y/ies)`: one thing takes the
 * singular, any other number the plural.
 *
 * Kept free of imports so any layer can use it.
 *
 * @module
 */

/**
 * Renders a count followed by its noun in the right number.
 *
 * @param count - How many there are.
 * @param singular - The noun for exactly one.
 * @param plural - The noun for any other count; defaults to `singular` + `s`.
 * @returns `1 feed`, `3 feeds`, `0 queries`.
 */
export function count_noun(count: number, singular: string, plural: string = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
