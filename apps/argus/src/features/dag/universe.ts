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

/** One node of a feed's collapsed shape. */
export interface LandedGroup {
  plugin: string;
  count: number;
  status: string;
  parent: number | null;
}

/** One feed as the session reported it landing. */
export interface LandedFeed {
  id: number;
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
export function universeGraph_build(landed: ReadonlyArray<LandedFeed>): SceneGraph {
  const nodes: SceneNode[] = [];
  const anchors: Set<string> = new Set();
  const feeds: LandedFeed[] = [...landed].sort((a: LandedFeed, b: LandedFeed): number => a.id - b.id);
  for (const feed of feeds) {
    if (feed.groups.length === 0) continue;
    const shape: string = shape_of(feed);
    const anchor: string = anchorId_of(shape);
    if (!anchors.has(shape)) {
      anchors.add(shape);
      // No mass: an anchor gathers its feeds without carving room of its own.
      nodes.push({ id: anchor, label: '', parentIds: [], joinParentIds: [], ghost: true, metric: 1 });
    }
    feed.groups.forEach((group: LandedGroup, index: number): void => {
      nodes.push({
        id: groupId_of(feed.id, index),
        label: group.plugin,
        parentIds: [group.parent === null ? anchor : groupId_of(feed.id, group.parent)],
        joinParentIds: [],
        status: group.status,
        metric: Math.max(1, group.count),
        ...(group.count > 1 ? { count: group.count } : {}),
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

  /** Forgets everything: the index came whole and the roster takes over. */
  public clear(): void {
    this.byId.clear();
  }
}
