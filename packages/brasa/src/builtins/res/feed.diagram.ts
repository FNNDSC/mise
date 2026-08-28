/**
 * @file `feed diagram --signalflow <id>` — emit a feed's DAG as a SignalFlow document.
 *
 * This command does not render or presume anything: it builds the feed graph cache-first,
 * collapses it, adapts it to a SignalFlow document, and writes that document as **YAML to
 * stdout**. Rendering is the user's business and composes with pipes:
 *
 *   feed diagram --signalflow 1669 | signalflow -            # ASCII (read stdin via `-`)
 *   feed diagram --signalflow 1669 | signalflow - -o x.svg   # SVG
 *   feed diagram --signalflow 1669 > feed-1669.yaml        # keep it
 *
 * SignalFlow is a replaceable rendering leaf; mise only emits the representation. Additional
 * dialects (`--json`, `--dot`, …) would each be another emitter.
 *
 * @module
 */
import chalk from 'chalk';
import { dump as yamlDump } from 'js-yaml';
import { feedGraphData_ensure, feedGraph_build, FeedGraph } from '@fnndsc/salsa';
import { type CommandEnvelope, envelope_ok, envelope_error } from '@fnndsc/cumin';
import { feedDiagramNodes_build, feedTree_render, type FeedTreeRender } from './feed.tree.render.js';
import { signalflowDoc_build } from './feed.tree.signalflow.js';
import {
  DAG_MODEL_KINDS,
  dagNodeStatusSchema,
  type FeedDagModel,
  type DagNodeStatus,
} from '@fnndsc/menu';
import type { FeedNode } from '@fnndsc/salsa';

/** Supported emit dialects. */
export type DiagramDialect = 'signalflow';

/**
 * Handles `feed diagram --<dialect> <feedId>`. Emits the diagram document to stdout for the
 * user to pipe into a renderer.
 *
 * @param feedId - Feed to emit.
 * @param dialect - Output dialect (currently only `signalflow`).
 * @returns An envelope whose rendered text is the diagram document (YAML).
 */
export async function feedDiagram_handle(feedId: number, dialect: DiagramDialect): Promise<CommandEnvelope> {
  await feedGraphData_ensure(feedId);
  const graph: FeedGraph | null = feedGraph_build(feedId);
  if (!graph) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`Feed ${feedId} not found.`)}\n`);
  }

  const doc = signalflowDoc_build(feedDiagramNodes_build(graph, graph.rootIDs), {
    subject: 'feed',
    subjectID: feedId,
    title: graph.title,
  });
  const yaml: string = yamlDump(doc, { lineWidth: -1, noRefs: true });

  return envelope_ok(yaml, { kind: DAG_MODEL_KINDS.feedDag, data: feedDagModel_build(graph) });
}

/**
 * Projects a built feed graph onto the wire's `feed.dag` model: the live
 * topology with each node's status and its data-space address. The address
 * is the node's `/proc` data link — the same path the terminal and the
 * files panel navigate, so a surface's "fly into this node" is a `cd`.
 *
 * @param graph - The cache-first feed graph.
 * @returns The typed model payload.
 */
export function feedDagModel_build(graph: FeedGraph): FeedDagModel {
  return {
    feedId: graph.feedID,
    feedName: graph.title,
    nodes: graph.nodes.map((node: FeedNode) => {
      const status: DagNodeStatus = dagNodeStatusSchema.parse(node.status ?? 'unknown');
      return {
        id: String(node.id),
        label: node.pluginName,
        parentIds: node.parentID === null ? [] : [String(node.parentID)],
        joinParentIds: node.joinParentIDs.map((joinId: number): string => String(joinId)),
        instanceId: node.id,
        pluginName: node.pluginName,
        status,
        vfsPath: `/proc/jobs/feed_${graph.feedID}/${node.pluginName}_${node.id}/data`,
      };
    }),
  };
}

/**
 * Handles plain `feed diagram <feed>`: the rendered tree a terminal shows,
 * carrying the `feed.dag` model a graphical surface draws. One command, one
 * declaration, two projections.
 *
 * @param feedId - Feed to project.
 * @param focusId - Optional node to focus the rendering on.
 * @param maxNodes - Rendering size guard.
 * @param flat - Flat rendering toggle.
 * @returns An envelope with the rendered tree and the `feed.dag` model.
 */
export async function feedDag_handle(
  feedId: number,
  focusId: number | undefined,
  maxNodes: number,
  flat: boolean = false,
): Promise<CommandEnvelope> {
  await feedGraphData_ensure(feedId);
  const graph: FeedGraph | null = feedGraph_build(feedId);
  if (!graph) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(`Feed ${feedId} not found.`)}\n`);
  }
  const rendered: FeedTreeRender = feedTree_render(graph, focusId, maxNodes, flat);
  if (rendered.error) {
    process.exitCode = 1;
    return envelope_error('', undefined, `${chalk.red(rendered.error)}\n`);
  }
  return envelope_ok(rendered.rendered, { kind: DAG_MODEL_KINDS.feedDag, data: feedDagModel_build(graph) });
}
