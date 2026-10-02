/**
 * @file A feed's DAG as the scene draws it: the kernel's nodes read into
 * scene nodes under the pane's modes — which metric sizes a sphere, which
 * hue colours it — and the hue legend a compute mode assigns.
 *
 * Pure over the model: the pane keeps its modes and its chrome, and hands
 * the model here to be read.
 */
import type { FeedDagModel, FeedDagNode } from '@fnndsc/menu';
import type { SceneGraph, SceneNode } from '../../scene/chrisSpace.js';

/** What sizes a molecule's spheres: wall time, or output bytes. */
export type MetricMode = 'time' | 'size';

/** What colours a node: its status, or the compute resource it ran on. */
export type HueMode = 'status' | 'compute';

/** The grey a node of no known compute wears under the compute hue. */
export const HUE_UNKNOWN: string = '#555';

/**
 * A node's metric under a mode.
 *
 * @param node - The kernel's node.
 * @param mode - Which metric.
 * @returns The metric, or undefined when the cache does not hold it yet.
 */
export function dagMetric_of(node: FeedDagNode, mode: MetricMode): number | undefined {
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
 * The model as the scene draws it.
 *
 * @param model - The kernel's graph of the feed.
 * @param metric - Which metric sizes the spheres.
 * @param hue - What colours a node.
 * @param legend - The compute hues, read under the compute mode.
 * @returns The scene's graph.
 */
export function dagGraph_build(model: FeedDagModel, metric: MetricMode, hue: HueMode, legend: ReadonlyMap<string, string>): SceneGraph {
  const hue_of = (node: FeedDagNode): string | undefined => {
    if (hue !== 'compute') return undefined;
    if (node.computeResource === undefined) return HUE_UNKNOWN;
    return legend.get(node.computeResource) ?? HUE_UNKNOWN;
  };
  return {
    nodes: model.nodes.map((node: FeedDagNode): SceneNode => {
      const colour: string | undefined = hue_of(node);
      return {
        id: node.id,
        label: node.label,
        parentIds: node.parentIds,
        joinParentIds: node.joinParentIds,
        status: node.status,
        metric: dagMetric_of(node, metric),
        count: node.tally?.count,
        ...(colour !== undefined ? { hue: colour } : {}),
      };
    }),
  };
}
