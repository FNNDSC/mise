/**
 * @file Names in paths: display names, never ids, and what happens when two
 * share one (docs/stratus.adoc, D4).
 *
 * A duplicate shows as `name~<last six of its id>`; the plain name refuses
 * as ambiguous, never picks one. The rule holds wherever a path is resolved.
 *
 * @module
 */

/** Something with a display name and an id. */
export interface Named {
  readonly name: string;
  readonly id: string;
}

/** A path segment and the thing it names. */
export interface Segment<T extends Named> {
  readonly segment: string;
  readonly item: T;
}

/** The suffix a duplicate wears: the last six characters of its id. */
export function idSuffix_of(id: string): string {
  return id.slice(-6);
}

/**
 * The path segment for each item: its name, or `name~<id6>` when another
 * item in the same listing has the same name.
 *
 * @param items - The listing.
 * @returns A segment per item, in the same order.
 */
export function segments_assign<T extends Named>(items: ReadonlyArray<T>): Segment<T>[] {
  const counts: Map<string, number> = new Map();
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  return items.map((item: T): Segment<T> => ({
    segment: (counts.get(item.name) ?? 0) > 1 ? `${item.name}~${idSuffix_of(item.id)}` : item.name,
    item,
  }));
}

/** What resolving a segment came to. */
export type SegmentMatch<T extends Named> =
  | { readonly kind: 'one'; readonly item: T }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly segments: string[] };

/**
 * The item a path segment names: the plain name when one item has it, the
 * suffixed form when several do, and a refusal naming every suffixed form
 * when the plain name is asked for a duplicate.
 *
 * @param items - The listing the segment is resolved in.
 * @param segment - The segment as typed.
 * @returns The match.
 */
export function segment_resolve<T extends Named>(items: ReadonlyArray<T>, segment: string): SegmentMatch<T> {
  const assigned: Segment<T>[] = segments_assign(items);
  const exact: Segment<T> | undefined = assigned.find((entry: Segment<T>): boolean => entry.segment === segment);
  if (exact !== undefined) return { kind: 'one', item: exact.item };
  const sameName: Segment<T>[] = assigned.filter((entry: Segment<T>): boolean => entry.item.name === segment);
  if (sameName.length === 0) return { kind: 'none' };
  return { kind: 'ambiguous', segments: sameName.map((entry: Segment<T>): string => entry.segment) };
}

/** The words a refusal of an ambiguous name uses. */
export function ambiguity_words(segment: string, segments: ReadonlyArray<string>): string {
  return `${segment}: ambiguous: ${segments.join(', ')}`;
}
