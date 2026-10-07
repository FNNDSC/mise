/**
 * @file A feed's graph as the scene draws it, the one way (law
 * a-feed-has-one-view): the kernel's `feed.dag` read into scene nodes for
 * the RUNS pane and for the universe's descent alike.
 *
 * There were two readings of the one model — the RUNS pane's (its metric,
 * its hue, plain ids) and the descent's (a job-count size, an errored
 * share, ids scoped to the universe, every node marked solid) — and the
 * same feed looked like two different things depending on the door it was
 * reached by. Now a door chooses only its ids (the descent's must not
 * collide with the rest of the space); everything that changes how the
 * feed looks is the feed view's own: the metric that sizes a sphere, the
 * hue that colours it, the errored share a `×N` sphere wears, and every
 * node tubed, so its paths show whatever the draw style (and solid, lit and
 * pressed as a sphere, unless the view is drawn as stars).
 *
 * Pure over the model.
 *
 * @module
 */
import type { FeedDagModel, FeedDagNode } from '@fnndsc/menu';
import type { SceneNode } from './chrisSpace.js';

/** What sizes a feed's spheres: wall time, or output bytes. */
export type MetricMode = 'time' | 'size';

/** What colours a node: its status, or the compute resource it ran on. */
export type HueMode = 'status' | 'compute';

/** The grey a node of no known compute wears under the compute hue. */
export const HUE_UNKNOWN: string = '#555';

/** How a feed is read: the view's modes, and the ids its door draws under. */
export interface FeedGraphModes {
  metric: MetricMode;
  hue: HueMode;
  /** The compute hues, read under the compute mode. */
  legend: ReadonlyMap<string, string>;
  /**
   * How the view draws: lit spheres mark every node solid; stars leave the
   * nodes points of light. Either way every node keeps its tube.
   */
  draw?: 'spheres' | 'stars';
  /** A node's scene id from the kernel's; the RUNS pane keeps the kernel's, the universe scopes it. */
  id_of?: (nodeId: string) => string;
}

/** A feed read for the scene: its nodes, and the kernel node each stands for. */
export interface FeedGraph {
  nodes: SceneNode[];
  payloads: Map<string, FeedDagNode>;
}

/**
 * A node's metric under a mode.
 *
 * @param node - The kernel's node.
 * @param mode - Which metric.
 * @returns The metric, or undefined when the cache does not hold it yet.
 */
export function feedMetric_of(node: FeedDagNode, mode: MetricMode): number | undefined {
  return mode === 'time' ? node.metrics?.computeSeconds : node.metrics?.dataBytes;
}

/**
 * Assigns a hue per distinct compute resource in the model, from a cycle
 * of colours, in order of first appearance; `mixed` groups wear the
 * unknown grey.
 *
 * @param model - The model on stage.
 * @param cycle - The colours to assign, in order.
 * @returns Resource to CSS colour.
 */
export function hueLegend_build(model: FeedDagModel, cycle: ReadonlyArray<string>): Map<string, string> {
  const legend: Map<string, string> = new Map();
  for (const node of model.nodes) {
    const resource: string | undefined = node.computeResource;
    if (resource === undefined || resource === 'mixed' || legend.has(resource)) continue;
    legend.set(resource, cycle[legend.size % Math.max(1, cycle.length)] ?? '#888');
  }
  return legend;
}

/**
 * A feed's graph as the scene draws it, from either door.
 *
 * @param model - The kernel's graph of the feed.
 * @param modes - The feed view's modes and the door's ids.
 * @returns The scene nodes and the kernel node each stands for.
 */
export function feedGraph_build(model: FeedDagModel, modes: FeedGraphModes): FeedGraph {
  const id_of: (nodeId: string) => string = modes.id_of ?? ((nodeId: string): string => nodeId);
  const known: Set<string> = new Set(model.nodes.map((node: FeedDagNode): string => node.id));
  const hue_of = (node: FeedDagNode): string | undefined => {
    if (modes.hue !== 'compute') return undefined;
    if (node.computeResource === undefined) return HUE_UNKNOWN;
    return modes.legend.get(node.computeResource) ?? HUE_UNKNOWN;
  };
  const nodes: SceneNode[] = [];
  const payloads: Map<string, FeedDagNode> = new Map();
  for (const node of model.nodes) {
    const id: string = id_of(node.id);
    const count: number = node.tally?.count ?? 1;
    const errored: number = node.tally?.error ?? (node.status === 'finishedWithError' ? 1 : 0);
    const share: number | undefined = errored > 0 && count > 1 ? Math.min(1, errored / count) : undefined;
    const colour: string | undefined = hue_of(node);
    nodes.push({
      id,
      label: node.label,
      // A parent the model does not hold (a node beyond the kernel's budget) is no edge.
      parentIds: node.parentIds.filter((parent: string): boolean => known.has(parent)).map(id_of),
      joinParentIds: node.joinParentIds.filter((parent: string): boolean => known.has(parent)).map(id_of),
      status: node.status,
      metric: feedMetric_of(node, modes.metric),
      tubed: true,
      ...(modes.draw !== 'stars' ? { solid: true } : {}),
      ...(count > 1 ? { count } : {}),
      ...(share !== undefined ? { share } : {}),
      ...(colour !== undefined ? { hue: colour } : {}),
    });
    payloads.set(id, node);
  }
  return { nodes, payloads };
}
