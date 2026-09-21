/**
 * @file The space of everything run here, drawn as it lands.
 *
 * While the job index warms, the session reports each feed as its topology
 * lands: its size, its status, and the shape of its pipeline — the plugin
 * names root first. This builds the graph the RUNS canvas draws from them:
 * one root; a branch per plugin, shared by every feed whose pipeline began
 * the same way; each feed a leaf on the branch its shape ends at, sized by
 * its jobs and hued by its status. Feeds that ran the same pipeline hang
 * from the same twig, so the tree is a taxonomy of what this CUBE does,
 * materialising in the order the index read it.
 *
 * Every node is real: a plugin that ran, or a feed that exists. Nothing is
 * invented to fill the wait, which is what lets it be a readout rather
 * than a screensaver.
 *
 * @module
 */
import type { SceneGraph, SceneNode } from '../../scene/dagScene.js';

/** One feed as the session reported it landing. */
export interface LandedFeed {
  id: number;
  jobs: number;
  status: string;
  chain: string[];
}

/** The root the space hangs from. */
export const UNIVERSE_ROOT_ID: string = 'universe';

/** The id of the branch a plugin chain ends at. */
export function branchId_of(chain: string[]): string {
  return chain.length === 0 ? UNIVERSE_ROOT_ID : `branch:${chain.join('>')}`;
}

/** The id of a feed's leaf. */
export function leafId_of(feedId: number): string {
  return `feed:${feedId}`;
}

/**
 * Builds the space from the feeds that have landed so far.
 *
 * @param landed - The feeds, in any order; the graph is the same for any order.
 * @returns The graph: root, branches, leaves.
 */
export function universeGraph_build(landed: ReadonlyArray<LandedFeed>): SceneGraph {
  const nodes: SceneNode[] = [{ id: UNIVERSE_ROOT_ID, label: '', parentIds: [], joinParentIds: [] }];
  const branches: Map<string, SceneNode> = new Map();
  const feeds: LandedFeed[] = [...landed].sort((a: LandedFeed, b: LandedFeed): number => a.id - b.id);
  for (const feed of feeds) {
    let parentId: string = UNIVERSE_ROOT_ID;
    for (let depth = 1; depth <= feed.chain.length; depth++) {
      const prefix: string[] = feed.chain.slice(0, depth);
      const id: string = branchId_of(prefix);
      let branch: SceneNode | undefined = branches.get(id);
      if (branch === undefined) {
        branch = { id, label: prefix[depth - 1] ?? '', parentIds: [parentId], joinParentIds: [], count: 0 };
        branches.set(id, branch);
        nodes.push(branch);
      }
      // A branch counts the feeds that passed through it, so a shared
      // beginning reads as the trunk it is.
      branch.count = (branch.count ?? 0) + 1;
      parentId = id;
    }
    nodes.push({
      id: leafId_of(feed.id),
      label: '',
      parentIds: [parentId],
      joinParentIds: [],
      status: feed.status,
      metric: Math.max(1, feed.jobs),
    });
  }
  return { nodes };
}

/**
 * Keeps the feeds the session has reported, one per id, newest report
 * winning: a feed's status can move between one landing and the next.
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
      if (known !== undefined && known.status === feed.status && known.jobs === feed.jobs && known.chain.join('>') === feed.chain.join('>')) continue;
      this.byId.set(feed.id, { ...feed, chain: [...feed.chain] });
      changed = true;
    }
    return changed;
  }

  /** How many feeds have landed. */
  public size(): number {
    return this.byId.size;
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
