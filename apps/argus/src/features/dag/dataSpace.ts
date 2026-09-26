/**
 * @file The space arranged by what each feed began from: its DATA.
 *
 * The index says what a feed's data is — a format, and for DICOM a modality
 * and a series description. Here that becomes a tree of hubs the space
 * settles around: a hub per format, under it a hub per modality (DICOM
 * only), under that a hub per series-description group, and every feed hung
 * from its deepest hub. Descriptions are compared by their words, not their
 * spelling: `SAG MPRAGE 220 FOV` and `sag_mprage` are one group, named by
 * the description most feeds in it carry. A feed not yet read hangs from a
 * hub that says so; a feed the index could not read, from one that says why.
 *
 * Pure: landed feeds in, a scene graph out.
 *
 * @module
 */
import type { SceneGraph, SceneNode } from '../../scene/chrisSpace.js';
import { erroredShare_of, groupId_of, jobsMetric_of, type LandedFeed, type LandedGroup, type UniverseScale } from './universe.js';

/** Two descriptions whose words overlap this much are one group. */
export const DESCRIPTION_OVERLAP: number = 0.5;

/**
 * The least a description group holds to be labelled in the space: five
 * feeds, or two in every hundred. Formats and modalities are always
 * labelled; a group of one or two is a hover away — labelling every one
 * crowded the middle of the space unreadable.
 */
export const CAPTION_FEEDS_MIN: number = 5;
export const CAPTION_SHARE_MIN: number = 0.02;

/** The prefix of a data hub's id. */
const DATA_HUB_PREFIX: string = 'data:';

/** What the formats read as on a hub. */
const FORMAT_WORDS: Readonly<Record<string, string>> = {
  dicom: 'DICOM', nifti: 'NIfTI', mgz: 'MGZ', jpeg: 'JPEG', png: 'PNG', other: 'OTHER', unknown: 'UNREADABLE', unread: 'NOT YET READ',
};

/**
 * A description as words to compare: upper case, separators to spaces, and
 * the words that say nothing about the sequence dropped — pure numbers, and
 * sizes and fields of view (`220`, `256X256`, `FOV220`, `3MM`).
 *
 * @param description - A series description.
 * @returns Its words, in order, each once.
 */
export function descriptionWords_of(description: string): string[] {
  const words: string[] = description
    .toUpperCase()
    .replace(/[_\-.,/\\()[\]:;+]+/g, ' ')
    .split(/\s+/)
    .filter((word: string): boolean => word.length > 0)
    .filter((word: string): boolean => !/^\d+$/.test(word))
    .filter((word: string): boolean => !/^\d+X\d+$/.test(word))
    .filter((word: string): boolean => !/^FOV\d*$/.test(word))
    .filter((word: string): boolean => !/^\d+(\.\d+)?(MM|CM)$/.test(word));
  return [...new Set(words)];
}

/**
 * How much two sets of words overlap: shared over the smaller, so a short
 * description that is all of a longer one is the same series.
 *
 * @param a - Words.
 * @param b - Words.
 * @returns 0..1.
 */
export function wordOverlap_of(a: ReadonlyArray<string>, b: ReadonlyArray<string>): number {
  if (a.length === 0 || b.length === 0) return 0;
  const set: Set<string> = new Set(a);
  const shared: number = b.filter((word: string): boolean => set.has(word)).length;
  return shared / Math.min(a.length, b.length);
}

/**
 * Groups descriptions by their words: most common first, each joining the
 * first group whose name its words overlap enough, else starting its own.
 * A group is named by the description most of its members carry.
 *
 * @param descriptions - Each feed's description (repeats count).
 * @returns Each description's group name.
 */
export function descriptionGroups_of(descriptions: ReadonlyArray<string>): Map<string, string> {
  const counts: Map<string, number> = new Map();
  for (const description of descriptions) counts.set(description, (counts.get(description) ?? 0) + 1);
  const ordered: string[] = [...counts.keys()].sort((a: string, b: string): number => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (a < b ? -1 : 1));
  const groups: Array<{ name: string; words: string[] }> = [];
  const groupOf: Map<string, string> = new Map();
  for (const description of ordered) {
    const words: string[] = descriptionWords_of(description);
    const home = words.length === 0 ? undefined : groups.find((group) => wordOverlap_of(group.words, words) >= DESCRIPTION_OVERLAP);
    if (home !== undefined) {
      groupOf.set(description, home.name);
      continue;
    }
    groups.push({ name: description, words });
    groupOf.set(description, description);
  }
  return groupOf;
}

/**
 * Where a feed hangs in the DATA tree: its hubs from the format down, each
 * with its label.
 *
 * @param feed - The feed.
 * @param groupOf - Each description's group name.
 * @returns The path of hubs, format first.
 */
export function dataPath_of(feed: LandedFeed, groupOf: ReadonlyMap<string, string>): Array<{ key: string; label: string }> {
  const format: string = feed.data?.format ?? 'unread';
  const path: Array<{ key: string; label: string }> = [{ key: format, label: FORMAT_WORDS[format] ?? format.toUpperCase() }];
  if (format !== 'dicom') return path;
  const modality: string = feed.data?.modality ?? 'NO MODALITY';
  path.push({ key: `${format}/${modality}`, label: modality });
  const description: string | undefined = feed.data?.seriesDescription;
  const group: string = description === undefined ? 'NO DESCRIPTION' : groupOf.get(description) ?? description;
  path.push({ key: `${format}/${modality}/${group}`, label: group });
  return path;
}

/**
 * A data hub's id.
 *
 * @param key - The hub's path key (`dicom`, `dicom/MR`, `dicom/MR/SAG MPRAGE`).
 * @returns The id.
 */
export function dataHubId_of(key: string): string {
  return `${DATA_HUB_PREFIX}${key}`;
}

/**
 * The path key a data hub stands for.
 *
 * @param nodeId - A node id.
 * @returns The key, or null when the node is not a data hub.
 */
export function dataHubKey_of(nodeId: string): string | null {
  return nodeId.startsWith(DATA_HUB_PREFIX) ? nodeId.slice(DATA_HUB_PREFIX.length) : null;
}

/**
 * The space as DATA: every feed its own molecule, hung from the hub of what
 * it began from; hubs chained format → modality → description group, each
 * drawn as a nebula sized by the feeds beneath it.
 *
 * @param landed - Every landed feed.
 * @param scale - What sizes a stage.
 * @returns The graph, and each hub's label and feed count.
 */
export function dataGraph_build(landed: ReadonlyArray<LandedFeed>, scale: UniverseScale = 'jobs'): { graph: SceneGraph; hubs: Map<string, { label: string; feeds: number }> } {
  const feeds: LandedFeed[] = [...landed].filter((feed: LandedFeed): boolean => feed.groups.length > 0).sort((a: LandedFeed, b: LandedFeed): number => a.id - b.id);
  const groupOf: Map<string, string> = descriptionGroups_of(
    feeds.map((feed: LandedFeed): string | undefined => feed.data?.seriesDescription).filter((d: string | undefined): d is string => d !== undefined),
  );
  const hubs: Map<string, { label: string; feeds: number; parent: string | null }> = new Map();
  const nodes: SceneNode[] = [];
  for (const feed of feeds) {
    const path = dataPath_of(feed, groupOf);
    let parent: string | null = null;
    for (const step of path) {
      const known = hubs.get(step.key);
      if (known === undefined) hubs.set(step.key, { label: step.label, feeds: 1, parent });
      else known.feeds += 1;
      parent = step.key;
    }
    const leaf: string = dataHubId_of(parent as string);
    feed.groups.forEach((group: LandedGroup, index: number): void => {
      const share: number | undefined = erroredShare_of(group);
      nodes.push({
        id: groupId_of(feed.id, index),
        label: group.plugin,
        parentIds: [group.parent === null ? leaf : groupId_of(feed.id, group.parent)],
        joinParentIds: [],
        status: group.status,
        metric: scale === 'jobs' ? jobsMetric_of(group.count) : 1,
        ...(group.count > 1 ? { count: group.count } : {}),
        ...(share !== undefined ? { share } : {}),
      });
    });
  }
  // The hubs: no mass of their own, drawn as nebulae sized by their feeds,
  // each hung from the hub above it so a format's modalities gather.
  const captioned = (key: string, feedsUnder: number): boolean =>
    key.split('/').length < 3 || feedsUnder >= Math.max(CAPTION_FEEDS_MIN, CAPTION_SHARE_MIN * feeds.length);
  const hubNodes: SceneNode[] = [...hubs].map(([key, hub]): SceneNode => ({
    id: dataHubId_of(key),
    label: hub.label,
    parentIds: hub.parent === null ? [] : [dataHubId_of(hub.parent)],
    joinParentIds: [],
    // An anchor, not a body: as bodies the hubs drew a thread to every feed
    // they hold and still sat at the middle of their own clouds.
    ghost: true,
    halo: true,
    metric: 1,
    count: hub.feeds,
    // Read without hovering: what the hub is, and how many feeds hang from it.
    ...(captioned(key, hub.feeds) ? { caption: `${hub.label} · ${hub.feeds.toLocaleString('en-US')}` } : {}),
  }));
  return {
    graph: { nodes: [...hubNodes, ...nodes] },
    hubs: new Map([...hubs].map(([key, hub]) => [key, { label: hub.label, feeds: hub.feeds }])),
  };
}

/**
 * What a data hub's tip says: its path from the format down, and how many
 * feeds hang beneath it.
 *
 * @param nodeId - A node id.
 * @param hubs - The hubs, from {@link dataGraph_build}.
 * @returns The tip, or null when the node is not a data hub.
 */
export function dataHubTip_of(nodeId: string, hubs: ReadonlyMap<string, { label: string; feeds: number }>): string | null {
  const key: string | null = dataHubKey_of(nodeId);
  if (key === null) return null;
  const parts: string[] = key.split('/');
  const labels: string[] = parts.map((_part: string, index: number): string => hubs.get(parts.slice(0, index + 1).join('/'))?.label ?? parts[index] ?? '');
  const feeds: number = hubs.get(key)?.feeds ?? 0;
  return `${labels.join(' · ')} · ${feeds.toLocaleString('en-US')} feed${feeds === 1 ? '' : 's'}`;
}
