/**
 * @file The space of everything run here: feeds as molecules in a solution.
 *
 * As the index reads a feed the session says what it is: its jobs collapsed
 * by plugin per place in the pipeline — a chain is a chain, a fan of three
 * hundred conversions is one node of 300 — with a status on every node.
 * This builds the graph the RUNS canvas draws from them: every feed its own
 * small DAG, floating free, and likeness pulling like together: feeds of
 * one pipeline shape share an unseen anchor, so the space settles into
 * constellations of "things run this way". No root, no tree.
 *
 * Every node is real: a group of jobs that ran. Nothing is invented to fill
 * the wait, which is what lets it be a readout rather than a screensaver.
 *
 * @module
 */
import type { SceneGraph, SceneNode } from '../../scene/dagScene.js';
import type { FeedDagModel, FeedDagNode } from '@fnndsc/menu';

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

export function universeGraph_build(landed: ReadonlyArray<LandedFeed>, scale: UniverseScale = 'jobs'): SceneGraph {
  const nodes: SceneNode[] = [];
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

/**
 * Keeps the feeds the session has reported, one per id, newest report
 * winning: a feed fills out between one landing and the next.
 */
export class LandedFeeds {
  private readonly byId: Map<number, LandedFeed> = new Map();

  /**
   * Takes a report and says whether it changed anything.
   *
   * @param landed - The feeds on one prompt push.
   * @returns True when a feed was new or moved.
   */
  public take(landed: ReadonlyArray<LandedFeed>): boolean {
    let changed: boolean = false;
    for (const feed of landed) {
      const known: LandedFeed | undefined = this.byId.get(feed.id);
      if (known !== undefined && known.status === feed.status && known.jobs === feed.jobs && JSON.stringify(known.groups) === JSON.stringify(feed.groups)) continue;
      this.byId.set(feed.id, { ...feed, chain: [...feed.chain], groups: feed.groups.map((group: LandedGroup): LandedGroup => ({ ...group })) });
      changed = true;
    }
    return changed;
  }

  /** How many feeds have landed. */
  public size(): number {
    return this.byId.size;
  }

  /** How many distinct shapes they run. */
  public shapes(): number {
    return new Set([...this.byId.values()].map(shape_of)).size;
  }

  /** Every landed feed. */
  public all(): LandedFeed[] {
    return [...this.byId.values()];
  }

  public get(id: number): LandedFeed | undefined {
    return this.byId.get(id);
  }

  /** Forgets everything: the index came whole and the roster takes over. */
  public clear(): void {
    this.byId.clear();
  }
}

/**
 * The words a hover over one sphere gives: the group it stands for and the
 * feed it belongs to. A sphere is a plugin group, never a feed, and a
 * pointer over it should learn both without a click.
 *
 * @param nodeId - The scene node under the pointer.
 * @param feeds - What has landed.
 * @returns The tip, or null for a node the universe does not name (an anchor).
 */
export function universeTip_of(nodeId: string, feeds: LandedFeeds): string | null {
  const match: RegExpMatchArray | null = nodeId.match(/^feed:(\d+):(\d+)$/);
  if (match === null) return null;
  const feed: LandedFeed | undefined = feeds.get(Number(match[1]));
  const group: LandedGroup | undefined = feed?.groups[Number(match[2])];
  if (feed === undefined || group === undefined) return null;
  const count: string = group.count > 1 ? ` ×${group.count.toLocaleString('en-US')}` : '';
  const name: string = feed.title.length > 0 ? ` · ${feed.title}` : '';
  // A fan with failures is said by its count of them, not by the worst word.
  const how: string = group.errored > 0 && group.count > 1
    ? `${group.errored.toLocaleString('en-US')} errored`
    : group.status;
  return `${group.plugin}${count} · ${how} · feed ${feed.id}${name}`;
}

/** Where a universe's remembered positions are kept, per identity. */
export function universeStoreKey_of(user: string, uri: string): string {
  return `argus.universe.${user}@${uri}`;
}

/** Positions as they are kept: node id to a rounded triple. */
export type StoredPositions = Record<string, [number, number, number]>;

/**
 * Reads remembered positions, tolerating anything that is not what was
 * written (another version, a hand edit, an empty store).
 *
 * @param text - The stored text, or null.
 * @returns The positions, empty when there are none to trust.
 */
export function storedPositions_parse(text: string | null): StoredPositions {
  if (text === null || text.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: StoredPositions = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length === 3 && value.every((n: unknown): boolean => typeof n === 'number' && Number.isFinite(n))) {
        out[id] = [value[0] as number, value[1] as number, value[2] as number];
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** The scene id of one instance node inside an entered feed. */
export function instanceId_of(feedId: number, nodeId: string): string {
  return `inst:${feedId}:${nodeId}`;
}

/** An entered feed's graph: its nodes, and what each stands for. */
export interface EnteredFeed {
  nodes: SceneNode[];
  payloads: Map<string, FeedDagNode>;
}

/**
 * The nodes of one feed as the kernel's `feed.dag` gives them, ready for
 * the scene. The kernel already collapses a fan into one node with a
 * tally, which is the budget the descent keeps: a group past it stays a
 * `×N` sphere with its count and its errored share, and the true numbers
 * ride the payload for the facts. Roots hang from nothing: an entered
 * feed keeps its place by its seed, not by a link — its shape anchor may
 * stand a hundred units off across the cluster, and a root linked to it
 * at full strength dragged the whole feed there as it unfolded.
 *
 * @param model - The kernel's graph of the feed.
 * @returns The scene nodes and their payloads.
 */
export function enteredFeed_build(model: FeedDagModel): EnteredFeed {
  const known: Set<string> = new Set(model.nodes.map((node: FeedDagNode): string => node.id));
  const nodes: SceneNode[] = [];
  const payloads: Map<string, FeedDagNode> = new Map();
  for (const node of model.nodes) {
    const id: string = instanceId_of(model.feedId, node.id);
    const parents: string[] = node.parentIds.filter((parent: string): boolean => known.has(parent)).map((parent: string): string => instanceId_of(model.feedId, parent));
    const count: number = node.tally?.count ?? 1;
    const errored: number = node.tally?.error ?? (node.status === 'finishedWithError' ? 1 : 0);
    const share: number | undefined = errored > 0 && count > 0 ? Math.min(1, errored / count) : undefined;
    nodes.push({
      id,
      label: node.pluginName,
      parentIds: parents,
      joinParentIds: node.joinParentIds.filter((parent: string): boolean => known.has(parent)).map((parent: string): string => instanceId_of(model.feedId, parent)),
      status: node.status,
      metric: jobsMetric_of(count),
      ...(count > 1 ? { count } : {}),
      ...(share !== undefined ? { share } : {}),
    });
    payloads.set(id, node);
  }
  return { nodes, payloads };
}

/**
 * The universe with one feed entered: that feed's molecule replaced by its
 * graph, every other feed dimmed, the anchors as they were.
 *
 * @param landed - What has landed.
 * @param feedId - The feed entered.
 * @param entered - Its graph.
 * @param scale - What sizes the other spheres.
 * @returns The scene graph.
 */
export function descendedGraph_build(landed: ReadonlyArray<LandedFeed>, feedId: number, entered: EnteredFeed, scale: UniverseScale = 'jobs'): SceneGraph {
  const whole: SceneGraph = universeGraph_build(landed, scale);
  const prefix: string = `feed:${feedId}:`;
  const nodes: SceneNode[] = whole.nodes
    .filter((node: SceneNode): boolean => !node.id.startsWith(prefix))
    .map((node: SceneNode): SceneNode => ({ ...node, dim: true }));
  return { nodes: [...nodes, ...entered.nodes] };
}

/**
 * The scene ids of one feed's spheres in the universe as drawn.
 *
 * @param feedId - The feed.
 * @param feed - Its landing.
 * @returns The ids, one per group.
 */
export function sphereIds_of(feedId: number, feed: LandedFeed): string[] {
  return feed.groups.map((_group: LandedGroup, index: number): string => groupId_of(feedId, index));
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

/**
 * A shape in few words, for a title: the first plugins and how many more.
 *
 * @param shape - The shape string.
 * @param keep - How many plugins to name.
 * @returns `pl-a > pl-b > pl-c … +8` or the whole when it is short.
 */
export function shapeWords_brief(shape: string, keep: number = 3): string {
  const words: string[] = shapeWords_of(shape).split(' > ');
  if (words.length <= keep) return words.join(' > ');
  return `${words.slice(0, keep).join(' > ')} … +${words.length - keep}`;
}

/**
 * The words a hover over a cluster's halo gives: the shape and how many
 * feeds share it.
 *
 * @param nodeId - The anchor under the pointer.
 * @param feeds - What has landed.
 * @returns The tip, or null for a node that is not an anchor.
 */
export function clusterTip_of(nodeId: string, feeds: LandedFeeds): string | null {
  if (!nodeId.startsWith('shape:')) return null;
  const shape: string = nodeId.slice('shape:'.length);
  const count: number = feeds.all().filter((feed: LandedFeed): boolean => shape_of(feed) === shape).length;
  return `${shapeWords_of(shape)} · ${count} feed${count === 1 ? '' : 's'}`;
}

/**
 * The spheres of every feed that shares a shape.
 *
 * @param shape - The shape.
 * @param feeds - What has landed.
 * @returns Their scene ids.
 */
export function clusterIds_of(shape: string, feeds: LandedFeeds): string[] {
  const ids: string[] = [];
  for (const feed of feeds.all()) {
    if (shape_of(feed) !== shape) continue;
    ids.push(...sphereIds_of(feed.id, feed));
  }
  return ids;
}

/**
 * The universe with one cluster in view: every feed outside the shape
 * dimmed, the anchors as they were.
 *
 * @param landed - What has landed.
 * @param shape - The shape in view.
 * @param scale - What sizes the spheres.
 * @returns The scene graph.
 */
export function clusterGraph_build(landed: ReadonlyArray<LandedFeed>, shape: string, scale: UniverseScale = 'jobs'): SceneGraph {
  const whole: SceneGraph = universeGraph_build(landed, scale);
  const inside: Set<number> = new Set(landed.filter((feed: LandedFeed): boolean => shape_of(feed) === shape).map((feed: LandedFeed): number => feed.id));
  const nodes: SceneNode[] = whole.nodes.map((node: SceneNode): SceneNode => {
    if (node.ghost === true) return node.id === anchorId_of(shape) ? node : { ...node, dim: true };
    const match: RegExpMatchArray | null = node.id.match(/^feed:(\d+):/);
    return match !== null && inside.has(Number(match[1])) ? node : { ...node, dim: true };
  });
  return { nodes };
}
