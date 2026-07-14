/**
 * @file `feed tree <id>` — loads a feed's DAG and renders it as an annotated text tree.
 *
 * This is the network-bound handler: it loads feed metadata, topology, and join edges,
 * then defers the drawing to the pure {@link feedTree_render}. Aggregation and the
 * signalflow renderer are later increments.
 *
 * @module
 */
import chalk from 'chalk';
import { procCache_refresh, feedJoins_ensure, feedGraph_build, FeedGraph } from '@fnndsc/salsa';
import { type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { feedTree_render, FeedTreeRender } from './feed.tree.render.js';

/**
 * Handles `feed tree <feedId> [--focus <id>] [--max-nodes <n>]`. Loads feed metadata
 * (counters → feed status) + topology, resolves join edges, then renders the tree.
 *
 * @param feedId - Feed to render.
 * @param focusId - Optional subtree root to scope the render to.
 * @param maxNodes - Node cap (0 = unlimited).
 * @returns An envelope carrying the rendered tree and the FeedGraph model.
 */
export async function feedTree_handle(
  feedId: number,
  focusId: number | undefined,
  maxNodes: number,
): Promise<CommandEnvelope> {
  await procCache_refresh(feedId);
  await feedJoins_ensure(feedId);

  const graph: FeedGraph | null = feedGraph_build(feedId);
  if (!graph) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`Feed ${feedId} not found.`)}\n`);
  }

  const result: FeedTreeRender = feedTree_render(graph, focusId, maxNodes);
  if (result.error) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(result.error)}\n`);
  }

  const model: FeedGraph = { ...graph, shown: result.shown, truncated: result.truncated };
  return envelope_ok(result.rendered, { kind: 'feed.tree', data: model });
}
