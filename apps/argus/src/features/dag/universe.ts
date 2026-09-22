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
  return `${group.plugin}${count} · ${group.status} · feed ${feed.id}${name}`;
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
