/**
 * @file Pure renderer for `feed tree` — turns a FeedGraph into an annotated text tree.
 *
 * No network and no runtime dependency on salsa (types only), so it is unit-testable in
 * isolation. Two modes: the default collapses isomorphic siblings into `×N` template nodes
 * with a status bar and surfaced anomalies; `--flat` draws every node. Topological-join
 * (`ts`) nodes are annotated inline with the extra sources they merge.
 *
 * @module
 */
import chalk from 'chalk';
import type { FeedGraph, FeedNode } from '@fnndsc/salsa';
import { collapse_build, CollapsedNode, StatusTally } from './feed.tree.collapse.js';
import {
  diagramTopology_nest,
  diagramTree_walk,
  type DiagramNode,
  type DiagramTreeWalk,
} from './diagram.tree.js';

/** Max anomalous ids listed on a collapsed group line before eliding. */
const MAX_ANOMALY_IDS: number = 3;
/** Width of the status distribution bar. */
const BAR_WIDTH: number = 10;

/** Colors a status label for the tree. */
export function status_paint(status: string | null): string {
  if (status === null) return chalk.dim('·');
  if (status === 'finishedSuccessfully') return chalk.green(status);
  if (status === 'finishedWithError') return chalk.red(status);
  if (status === 'cancelled') return chalk.yellow(status);
  return chalk.cyan(status);
}

/** Renders a proportional status distribution bar; error always gets at least one cell. */
export function status_bar(t: StatusTally): string {
  if (t.total === 0) return '';
  const cell = (n: number): number => (n > 0 ? Math.max(1, Math.round((n / t.total) * BAR_WIDTH)) : 0);
  let e: number = cell(t.error);
  let r: number = cell(t.running);
  let o: number = cell(t.other);
  let d: number = BAR_WIDTH - e - r - o;
  while (d < 0) { if (o > 0) o--; else if (r > 0) r--; else break; d = BAR_WIDTH - e - r - o; }
  return chalk.green('█'.repeat(Math.max(0, d))) + chalk.cyan('█'.repeat(r)) + chalk.dim('█'.repeat(o)) + chalk.red('█'.repeat(e));
}

/** Compact per-category counts, e.g. `97✓ 2⋯ 1✗`; zero categories omitted. */
function tally_label(t: StatusTally): string {
  const parts: string[] = [];
  if (t.done > 0) parts.push(chalk.green(`${t.done}✓`));
  if (t.running > 0) parts.push(chalk.cyan(`${t.running}⋯`));
  if (t.other > 0) parts.push(chalk.dim(`${t.other}·`));
  if (t.error > 0) parts.push(chalk.red(`${t.error}✗`));
  return parts.join(' ');
}

/** `⚠ id,id,…` for anomalous members, elided past MAX_ANOMALY_IDS. */
function anomaly_label(anomalies: CollapsedNode['anomalies']): string {
  if (anomalies.length === 0) return '';
  const shown: string = anomalies.slice(0, MAX_ANOMALY_IDS).map((a) => String(a.id)).join(',');
  const more: number = anomalies.length - MAX_ANOMALY_IDS;
  return chalk.yellow(`  ⚠ ${shown}${more > 0 ? `+${more}` : ''}`);
}

/** One collapsed node's line body — singleton (id + status) or `×N` group (bar + counts). */
function collapsedNode_label(node: CollapsedNode): string {
  if (node.count === 1) {
    const status: string = status_paint(node.anomalies.length > 0 ? node.anomalies[0].status : 'finishedSuccessfully');
    return `${node.pluginName}_${node.memberIds[0]}  ${status}`;
  }
  return `${chalk.bold(`${node.pluginName} ×${node.count}`)}  ${status_bar(node.tally)}  ${tally_label(node.tally)}${anomaly_label(node.anomalies)}`;
}

/** Builds nested diagram nodes for an uncollapsed feed. */
function feedFlatNodes_build(graph: FeedGraph, roots: number[]): DiagramNode[] {
  return diagramTopology_nest<FeedNode>(
    graph.nodes,
    roots,
    (node: FeedNode, children: DiagramNode[]): DiagramNode => {
      const status: string = status_paint(node.status);
      return {
        memberIDs: [node.id],
        pluginName: node.pluginName,
        functionName: `${node.pluginName}_${node.id}`,
        signalName: `${node.pluginName}_${node.id}`,
        label: `${node.pluginName}_${node.id}  ${status}`,
        multiplicity: 1,
        hasJoin: node.joinParentIDs.length > 0,
        joinParentIDs: node.joinParentIDs,
        arguments: [],
        children,
      };
    },
  );
}

/** Converts one collapsed feed node into the shared diagram model. */
function collapsedNode_toDiagram(node: CollapsedNode): DiagramNode {
  const functionName: string = node.count === 1
    ? `${node.pluginName}_${node.memberIds[0]}`
    : `${node.pluginName}_x${node.count}_${node.memberIds[0]}`;
  return {
    memberIDs: node.memberIds,
    pluginName: node.pluginName,
    functionName,
    signalName: functionName,
    label: collapsedNode_label(node),
    multiplicity: node.count,
    hasJoin: node.hasJoin,
    joinParentIDs: node.joinParentIDs,
    arguments: [],
    children: node.children.map((child: CollapsedNode): DiagramNode => collapsedNode_toDiagram(child)),
  };
}

/**
 * Adapts a feed graph to the shared nested diagram model.
 *
 * @param graph - Feed graph projection.
 * @param roots - Feed roots or focused subtree root.
 * @param flat - Whether to bypass sibling collapse.
 * @returns Nested diagram nodes for shallow or SignalFlow rendering.
 */
export function feedDiagramNodes_build(
  graph: FeedGraph,
  roots: number[],
  flat: boolean = false,
): DiagramNode[] {
  return flat
    ? feedFlatNodes_build(graph, roots)
    : collapse_build(graph, roots).map((node: CollapsedNode): DiagramNode => collapsedNode_toDiagram(node));
}

/** Outcome of the pure render: the tree text plus the counts, or a user error. */
export interface FeedTreeRender {
  rendered: string;
  shown: number;
  truncated: boolean;
  error?: string;
}

/**
 * Pure render of a {@link FeedGraph} into an annotated tree. Collapses isomorphic siblings
 * by default; `flat` draws every node. Returns `error` when `focusId` is not in the graph.
 *
 * @param graph - The feed's DAG.
 * @param focusId - Optional subtree root to scope the render to.
 * @param maxNodes - Node cap (0 = unlimited).
 * @param flat - Draw every node instead of collapsing isomorphic siblings.
 * @returns The rendered tree and counts, or an error message.
 */
export function feedTree_render(
  graph: FeedGraph,
  focusId: number | undefined,
  maxNodes: number,
  flat: boolean = false,
): FeedTreeRender {
  if (focusId !== undefined && !graph.nodes.some((n: FeedNode): boolean => n.id === focusId)) {
    return { rendered: '', shown: 0, truncated: false, error: `Node ${focusId} is not in feed ${graph.feedID}.` };
  }

  const roots: number[] = focusId !== undefined ? [focusId] : graph.rootIDs;
  const walk: DiagramTreeWalk = diagramTree_walk(feedDiagramNodes_build(graph, roots, flat), maxNodes);

  const mode: string = flat ? chalk.dim(' [flat]') : '';
  const header: string =
    `${chalk.bold(`feed ${graph.feedID}`)} ${chalk.gray(`"${graph.title}"`)} — ` +
    `${status_paint(graph.feedStatus)} · ${graph.total} nodes${mode}` +
    (walk.truncated ? chalk.yellow(`  (showing ${walk.shown}; --max-nodes 0 for all, --focus <id> to scope)`) : '');

  return {
    rendered: `${header}\n${walk.rendered}\n`,
    shown: walk.shown,
    truncated: walk.truncated,
  };
}
