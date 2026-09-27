/**
 * @file The universe as graphs: every feed the index holds, drawn as the
 * space a surface lays out.
 *
 * As the index reads a feed the session says what it is: its jobs collapsed
 * by plugin per place in the pipeline — a chain is a chain, a fan of three
 * hundred conversions is one node of 300 — with a status on every node.
 * These build the graphs a universe is laid out from — round each shape's
 * unseen hub, round the plugin stars, as data hubs, or grown in creation
 * order — pure functions of the feeds, shared by the surface that draws the
 * space and the session that lays it out once for every surface.
 *
 * Every node is real: a group of jobs that ran. Nothing is invented to fill
 * the wait, which is what lets it be a readout rather than a screensaver.
 *
 * @module
 */

/**
 * One node of a universe graph: what a layout places and a surface draws.
 * Structural, so a surface's own node type (with its look) accepts it.
 */
export interface UniverseNode {
  id: string;
  label: string;
  parentIds: string[];
  joinParentIds: string[];
  /** Execution status; undefined for an anchor. */
  status?: string;
  metric?: number;
  count?: number;
  /** The share of a collapsed group that ended in error, 0..1. */
  share?: number;
  ghost?: boolean;
  halo?: boolean;
  ring?: boolean;
  hue?: string;
  caption?: string;
  dim?: boolean;
  /** Its joins are a relation, not an edge of the run (lineage): drawn faint, never as tubes. */
  joinFaint?: boolean;
  attrs?: Record<string, number | string | string[]>;
}

/** A universe graph. */
export interface UniverseGraph {
  nodes: UniverseNode[];
}

/** One node of a feed's collapsed shape. */
export interface LandedGroup {
  plugin: string;
  count: number;
  /** How many of the count ended in error; zero from an older daemon. */
  errored: number;
  status: string;
  parent: number | null;
}

/** One feed as the session reported it landing. */
export interface LandedFeed {
  id: number;
  /** The feed's name, for the tip; empty from a daemon that predates it. */
  title: string;
  jobs: number;
  status: string;
  chain: string[];
  groups: LandedGroup[];
  /** When the feed was made (ISO 8601): the order a replay reveals it in; absent or empty from a daemon that predates it. */
  createdAt?: string;
  /** What the feed's data is, once the index has read it: its format, and for DICOM its modality and series description. */
  data?: { format: string; modality?: string; seriesDescription?: string; reason?: string; sourceFeed?: number };
}

/**
 * The signature of a feed's shape: what pulls like feeds together.
 *
 * @param feed - The feed.
 * @returns The plugins in group order with their parent places — the same
 *   for two feeds that ran the same pipeline, whatever their counts.
 */
export function shape_of(feed: LandedFeed): string {
  return feed.groups.map((group: LandedGroup): string => `${group.parent ?? 'r'}:${group.plugin}`).join('>');
}

/** The id of a feed's group node. */
export function groupId_of(feedId: number, index: number): string {
  return `feed:${feedId}:${index}`;
}

/** The id of a shape's unseen anchor. */
export function anchorId_of(shape: string): string {
  return `shape:${shape}`;
}

/**
 * Builds the space from the feeds that have landed so far.
 *
 * @param landed - The feeds, in any order; the graph is the same for any order.
 * @returns The graph: every feed's groups, and one ghost anchor per shape
 *   that each feed's root hangs from — present in the settle, never drawn.
 */
/**
 * What sizes a sphere: the jobs it stands for, on a log scale, or nothing
 * (every sphere alike, so the field reads by shape alone).
 */
export type UniverseScale = 'jobs' | 'feeds';

/**
 * A sphere's weight on the jobs scale. Logarithmic, because a group of
 * eighty thousand beside groups of three hundred left everything but the
 * giant at the smallest radius and the giant at the heart of gravity — a
 * fat caterpillar where a field should be.
 *
 * @param count - The jobs the group stands for.
 * @returns The metric the settle sizes by.
 */
export function jobsMetric_of(count: number): number {
  return Math.log2(Math.max(1, count) + 1);
}

/**
 * The share of a group that ended in error, 0..1, or undefined when none
 * did: what hues the sphere. A group is not red because one job in eighty
 * thousand failed; it is as red as its failures are many.
 *
 * @param group - The group.
 * @returns The share, or undefined for a clean group.
 */
export function erroredShare_of(group: LandedGroup): number | undefined {
  if (group.errored <= 0 || group.count <= 0) return undefined;
  return Math.min(1, group.errored / group.count);
}

export function universeGraph_build(landed: ReadonlyArray<LandedFeed>, scale: UniverseScale = 'jobs'): UniverseGraph {
  const nodes: UniverseNode[] = [];
  const anchors: Set<string> = new Set();
  const feeds: LandedFeed[] = [...landed].sort((a: LandedFeed, b: LandedFeed): number => a.id - b.id);
  const perShape: Map<string, number> = new Map();
  for (const feed of feeds) {
    if (feed.groups.length === 0) continue;
    const shape: string = shape_of(feed);
    perShape.set(shape, (perShape.get(shape) ?? 0) + 1);
  }
  for (const feed of feeds) {
    if (feed.groups.length === 0) continue;
    const shape: string = shape_of(feed);
    const anchor: string = anchorId_of(shape);
    if (!anchors.has(shape)) {
      anchors.add(shape);
      // No mass: an anchor gathers its feeds without carving room of its
      // own — but it is drawn as a halo, the cluster's handle, sized by
      // how many feeds share the shape.
      nodes.push({ id: anchor, label: shapeWords_of(shape), parentIds: [], joinParentIds: [], ghost: true, halo: true, metric: 1, count: perShape.get(shape) ?? 1 });
    }
    feed.groups.forEach((group: LandedGroup, index: number): void => {
      const share: number | undefined = erroredShare_of(group);
      nodes.push({
        id: groupId_of(feed.id, index),
        label: group.plugin,
        parentIds: [group.parent === null ? anchor : groupId_of(feed.id, group.parent)],
        joinParentIds: [],
        status: group.status,
        metric: scale === 'jobs' ? jobsMetric_of(group.count) : 1,
        ...(group.count > 1 ? { count: group.count } : {}),
        ...(share !== undefined ? { share } : {}),
      });
    });
  }
  return { nodes };
}

/** The prefix of a plugin star's id. */
const PLUGIN_STAR_PREFIX: string = 'plugin:';

/**
 * A plugin star's id.
 *
 * @param plugin - The plugin's name (versions collapse: the name alone).
 * @returns The id.
 */
export function pluginStarId_of(plugin: string): string {
  return `${PLUGIN_STAR_PREFIX}${plugin}`;
}

/**
 * The plugin a star stands for.
 *
 * @param nodeId - A node id.
 * @returns The plugin's name, or null when the node is not a plugin star.
 */
export function pluginOfStar(nodeId: string): string | null {
  return nodeId.startsWith(PLUGIN_STAR_PREFIX) ? nodeId.slice(PLUGIN_STAR_PREFIX.length) : null;
}

/**
 * The space as constellations: every feed its own molecule with no shape's
 * hub to hang from, each stage marked with its plugin, and one ringed star
 * per plugin, sized by the feeds that ran it — the engine places the stars
 * by what runs with what and pulls each stage to its own.
 *
 * @param landed - Every landed feed.
 * @param scale - What sizes a stage.
 * @returns The graph.
 */
export function constellationsGraph_build(landed: ReadonlyArray<LandedFeed>, scale: UniverseScale = 'jobs'): UniverseGraph {
  const nodes: UniverseNode[] = [];
  const feedsUsing: Map<string, number> = new Map();
  const feeds: LandedFeed[] = [...landed].sort((a: LandedFeed, b: LandedFeed): number => a.id - b.id);
  for (const feed of feeds) {
    if (feed.groups.length === 0) continue;
    for (const plugin of new Set(feed.groups.map((group: LandedGroup): string => group.plugin))) feedsUsing.set(plugin, (feedsUsing.get(plugin) ?? 0) + 1);
    feed.groups.forEach((group: LandedGroup, index: number): void => {
      const share: number | undefined = erroredShare_of(group);
      nodes.push({
        id: groupId_of(feed.id, index),
        label: group.plugin,
        parentIds: group.parent === null ? [] : [groupId_of(feed.id, group.parent)],
        joinParentIds: [],
        status: group.status,
        metric: scale === 'jobs' ? jobsMetric_of(group.count) : 1,
        attrs: { plugin: group.plugin },
        ...(group.count > 1 ? { count: group.count } : {}),
        ...(share !== undefined ? { share } : {}),
      });
    });
  }
  for (const [plugin, count] of [...feedsUsing].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    nodes.push({
      id: pluginStarId_of(plugin),
      label: plugin,
      parentIds: [],
      joinParentIds: [],
      // A star's mass is how many feeds ran it, on a log.
      metric: 1 + Math.log(count),
      hue: '#e8f4ff',
      ring: true,
      attrs: { kind: 'star', plugin },
    });
  }
  return { nodes };
}

/**
 * The space as it grows by accretion: every feed its own molecule, no hubs
 * and no stars, each stage carrying its plugin (what makes feeds alike) and
 * its feed's creation time (the order the coral grows in).
 *
 * @param landed - Every landed feed.
 * @param scale - What sizes a stage.
 * @returns The graph.
 */
export function accretionGraph_build(landed: ReadonlyArray<LandedFeed>, scale: UniverseScale = 'jobs'): UniverseGraph {
  const createdOf: Map<number, number> = new Map();
  for (const feed of landed) {
    const at: number = feed.createdAt === undefined ? Number.NaN : Date.parse(feed.createdAt);
    if (Number.isFinite(at)) createdOf.set(feed.id, at);
  }
  const nodes: UniverseNode[] = constellationsGraph_build(landed, scale).nodes
    .filter((node: UniverseNode): boolean => node.attrs?.['kind'] !== 'star')
    .map((node: UniverseNode): UniverseNode => {
      const created: number | undefined = createdOf.get(Number(node.id.split(':')[1]));
      return created === undefined ? node : { ...node, attrs: { ...node.attrs, createdAt: created } };
    });
  return { nodes };
}


/**
 * A shape in words: its plugins in pipeline order, each once.
 *
 * @param shape - The shape string (`r:pl-a>0:pl-b>0:pl-b`).
 * @returns `pl-a > pl-b`.
 */
export function shapeWords_of(shape: string): string {
  const seen: string[] = [];
  for (const part of shape.split('>')) {
    const plugin: string = part.slice(part.indexOf(':') + 1);
    if (plugin.length > 0 && !seen.includes(plugin)) seen.push(plugin);
  }
  return seen.join(' > ');
}

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
export function dataGraph_build(landed: ReadonlyArray<LandedFeed>, scale: UniverseScale = 'jobs'): { graph: UniverseGraph; hubs: Map<string, { label: string; feeds: number }> } {
  const feeds: LandedFeed[] = [...landed].filter((feed: LandedFeed): boolean => feed.groups.length > 0).sort((a: LandedFeed, b: LandedFeed): number => a.id - b.id);
  const groupOf: Map<string, string> = descriptionGroups_of(
    feeds.map((feed: LandedFeed): string | undefined => feed.data?.seriesDescription).filter((d: string | undefined): d is string => d !== undefined),
  );
  const hubs: Map<string, { label: string; feeds: number; parent: string | null }> = new Map();
  const nodes: UniverseNode[] = [];
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
  // Lineage: a feed whose data is another feed's output is joined to that
  // feed's root — a faint thread under stars, a join tube up close — and the
  // join draws the two a little together in the settle.
  const rootOf: Map<number, string> = new Map();
  for (const feed of feeds) {
    const index: number = feed.groups.findIndex((group: LandedGroup): boolean => group.parent === null);
    if (index >= 0) rootOf.set(feed.id, groupId_of(feed.id, index));
  }
  const nodeOf: Map<string, UniverseNode> = new Map(nodes.map((n: UniverseNode): [string, UniverseNode] => [n.id, n]));
  for (const feed of feeds) {
    const source: number | undefined = feed.data?.sourceFeed;
    const from: string | undefined = source === undefined || source === feed.id ? undefined : rootOf.get(source);
    const root: string | undefined = rootOf.get(feed.id);
    if (from === undefined || root === undefined) continue;
    const node: UniverseNode | undefined = nodeOf.get(root);
    if (node !== undefined) {
      node.joinParentIds = [...node.joinParentIds, from];
      node.joinFaint = true;
    }
  }
  // The hubs: no mass of their own, drawn as nebulae sized by their feeds,
  // each hung from the hub above it so a format's modalities gather.
  const captioned = (key: string, feedsUnder: number): boolean =>
    key.split('/').length < 3 || feedsUnder >= Math.max(CAPTION_FEEDS_MIN, CAPTION_SHARE_MIN * feeds.length);
  const hubNodes: UniverseNode[] = [...hubs].map(([key, hub]): UniverseNode => ({
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

// ── Laying the universe out ───────────────────────────────────────────────────

/** How far a sphere's repulsion reaches while the space is small: a molecule hugs itself at this bound. */
export const UNIVERSE_REACH: number = 12;
/** The most nodes a space may hold and still be bounded by {@link UNIVERSE_REACH}; a crowd is left unbounded. */
export const UNIVERSE_HUG_NODES: number = 240;

/** The layouts a universe can be laid out in. */
export type UniverseLayout = 'galaxy' | 'spokes' | 'clumps' | 'constellations' | 'data' | 'accretion';
/** Every layout, in the order the LAYOUT block offers them. */
export const UNIVERSE_LAYOUTS: ReadonlyArray<UniverseLayout> = ['galaxy', 'spokes', 'clumps', 'constellations', 'data', 'accretion'];

/**
 * The reach a space's settle takes: bounded while small, so a lone molecule
 * hugs itself, unbounded for a crowd.
 *
 * @param nodes - How many nodes the space holds.
 * @returns The reach, or undefined for none.
 */
export function universeReach_of(nodes: number): number | undefined {
  return nodes <= UNIVERSE_HUG_NODES ? UNIVERSE_REACH : undefined;
}

/**
 * The layout engine a universe layout runs: DATA settles its hub tree as the
 * galaxy does, under the engine named `hubs`.
 *
 * @param layout - The layout.
 * @returns The engine's name.
 */
export function universeEngine_of(layout: UniverseLayout): string {
  return layout === 'data' ? 'hubs' : layout;
}

/** A folded shape's stage id. */
export function foldId_of(shape: string, index: number): string {
  return `fold:${shape}:${index}`;
}

/**
 * The shape a folded stage belongs to.
 *
 * @param nodeId - A node id.
 * @returns The shape, or null when the node is not a folded stage.
 */
export function foldShape_of(nodeId: string): string | null {
  const match: RegExpMatchArray | null = nodeId.match(/^fold:(.+):\d+$/);
  return match === null ? null : (match[1] as string);
}

/**
 * The molecule a universe node belongs to: its feed, or its folded shape;
 * none for an anchor, a hub or a star.
 *
 * @param nodeId - A node id.
 * @returns The molecule's key, or null.
 */
export function universeKey_of(nodeId: string): string | null {
  const feed: RegExpMatchArray | null = nodeId.match(/^feed:(\d+):/);
  if (feed !== null) return `feed:${feed[1]}`;
  const folded: string | null = foldShape_of(nodeId);
  return folded === null ? null : `fold:${folded}`;
}

/**
 * The graph a universe layout is laid out from, over every feed (the FEEDS
 * view, sized by jobs): the one a surface draws, and the one a session lays
 * out for it.
 *
 * @param layout - The layout.
 * @param landed - Every landed feed.
 * @param scale - What sizes a stage.
 * @returns The graph.
 */
export function universeLayoutGraph_build(layout: UniverseLayout, landed: ReadonlyArray<LandedFeed>, scale: UniverseScale = 'jobs'): UniverseGraph {
  if (layout === 'constellations') return constellationsGraph_build(landed, scale);
  if (layout === 'data') return dataGraph_build(landed, scale).graph;
  if (layout === 'accretion') return accretionGraph_build(landed, scale);
  return universeGraph_build(landed, scale);
}
