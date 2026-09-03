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
import { collapse_build, type CollapsedNode } from './feed.tree.collapse.js';

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
 * Projects a built feed graph onto the wire's `feed.dag` model — COLLAPSED:
 * isomorphic sibling subtrees merge into one ×N node (the terminal tree's
 * own collapse transform), so an 88k-instance fan-out crosses the wire and
 * reaches the scene as its shape, not its census. Each node keeps a real
 * representative instance (id, data address), a worst-member status, summed
 * metrics, and — for groups — a tally with jump-to-error anomalies.
 *
 * @param graph - The cache-first feed graph.
 * @returns The typed model payload.
 */
export function feedDagModel_build(graph: FeedGraph): FeedDagModel {
  const byId: Map<number, FeedNode> = new Map(graph.nodes.map((n: FeedNode): [number, FeedNode] => [n.id, n]));
  const collapsed: CollapsedNode[] = collapse_build(graph, graph.rootIDs);

  // Join edges name original instance ids; a member inside a group is
  // addressed through its representative.
  const repOf: Map<number, number> = new Map<number, number>();
  const reps_walk = (node: CollapsedNode): void => {
    for (const member of node.memberIds) repOf.set(member, node.memberIds[0]);
    node.children.forEach(reps_walk);
  };
  collapsed.forEach(reps_walk);

  const nodes: FeedDagModel['nodes'] = [];
  const emit = (node: CollapsedNode, parentRep: number | null): void => {
    const rep: number = node.memberIds[0];
    const members: FeedNode[] = node.memberIds.map((id: number): FeedNode => byId.get(id)!);

    // Group metrics are sums: total compute spent and total bytes produced
    // are the honest figures for an ×N — and the molecule scales by them.
    let computeSeconds: number = 0;
    let seenSeconds: boolean = false;
    let dataBytes: number = 0;
    let seenBytes: boolean = false;
    for (const member of members) {
      if (member.startedAt !== undefined && member.finishedAt !== undefined) {
        const seconds: number = (Date.parse(member.finishedAt) - Date.parse(member.startedAt)) / 1000;
        if (!Number.isNaN(seconds)) {
          computeSeconds += Math.max(0, seconds);
          seenSeconds = true;
        }
      }
      if (member.outputBytes !== undefined) {
        dataBytes += member.outputBytes;
        seenBytes = true;
      }
    }
    const metrics: { computeSeconds?: number; dataBytes?: number } = {
      ...(seenSeconds ? { computeSeconds } : {}),
      ...(seenBytes ? { dataBytes } : {}),
    };
    // Where the work ran: one resource when the members agree, `mixed`
    // when they do not, nothing when none reported.
    const computes: Set<string> = new Set(
      members.map((member: FeedNode): string | undefined => member.computeResource).filter((name): name is string => name !== undefined),
    );
    const computeResource: string | undefined = computes.size === 0 ? undefined : computes.size === 1 ? [...computes][0] : 'mixed';

    // A group's status is its worst member's class — an error anywhere in
    // the set must be visible on the one node that stands for it.
    const status: DagNodeStatus =
      node.count === 1
        ? dagNodeStatusSchema.parse(members[0].status ?? 'unknown')
        : node.tally.error > 0
          ? 'finishedWithError'
          : node.tally.running > 0
            ? 'started'
            : node.tally.other > 0
              ? 'unknown'
              : 'finishedSuccessfully';

    nodes.push({
      id: String(rep),
      label: node.count === 1 ? node.pluginName : `${node.pluginName} \u00d7${node.count}`,
      parentIds: parentRep === null ? [] : [String(parentRep)],
      joinParentIds: node.joinParentIDs.map((joinId: number): string => String(repOf.get(joinId) ?? joinId)),
      instanceId: rep,
      pluginName: node.pluginName,
      status,
      vfsPath: `/proc/jobs/feed_${graph.feedID}/${node.pluginName}_${rep}/data`,
      ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
      ...(computeResource !== undefined ? { computeResource } : {}),
      ...(node.count > 1
        ? {
            tally: {
              count: node.count,
              done: node.tally.done,
              error: node.tally.error,
              running: node.tally.running,
              other: node.tally.other,
              ...(node.anomalies.length > 0
                ? {
                    anomalies: node.anomalies.slice(0, 12).map((a): { id: string; status: DagNodeStatus } => ({
                      id: String(a.id),
                      status: dagNodeStatusSchema.parse(a.status ?? 'unknown'),
                    })),
                  }
                : {}),
            },
          }
        : {}),
    });
    for (const child of node.children) emit(child, rep);
  };
  for (const root of collapsed) emit(root, null);

  return { feedId: graph.feedID, feedName: graph.title, nodes };
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
