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
    const join: string = node.joinParentIDs.length > 0 ? chalk.magenta(`  ⋈ joins ${node.joinParentIDs.join(',')}`) : '';
    return `${node.pluginName}_${node.memberIds[0]}  ${status}${join}`;
  }
  const join: string = node.hasJoin ? chalk.magenta('  ⋈') : '';
  return `${chalk.bold(`${node.pluginName} ×${node.count}`)}  ${status_bar(node.tally)}  ${tally_label(node.tally)}${anomaly_label(node.anomalies)}${join}`;
}

/** Result of a bounded tree walk. */
interface TreeWalk {
  lines: string[];
  shown: number;
  truncated: boolean;
}

/** Walks the anchor tree from the given roots, emitting box-drawing lines up to `maxNodes`. */
function tree_walk(graph: FeedGraph, roots: number[], maxNodes: number): TreeWalk {
  const byId: Map<number, FeedNode> = new Map(graph.nodes.map((n: FeedNode): [number, FeedNode] => [n.id, n]));
  const children: Map<number, number[]> = new Map<number, number[]>();
  for (const n of graph.nodes) {
    if (n.parentID !== null) {
      const kids: number[] = children.get(n.parentID) ?? [];
      kids.push(n.id);
      children.set(n.parentID, kids);
    }
  }

  const lines: string[] = [];
  let shown: number = 0;
  let truncated: boolean = false;

  const flat_label = (node: FeedNode): string => {
    const status: string = status_paint(node.status);
    const join: string = node.joinParentIDs.length > 0 ? chalk.magenta(`  ⋈ joins ${node.joinParentIDs.join(',')}`) : '';
    return `${node.pluginName}_${node.id}  ${status}${join}`;
  };

  const emit = (id: number, prefix: string, isLast: boolean, isRoot: boolean): void => {
    if (shown >= maxNodes) { truncated = true; return; }
    const node: FeedNode | undefined = byId.get(id);
    if (!node) return;
    const connector: string = isRoot ? '' : isLast ? '└─ ' : '├─ ';
    lines.push(`${prefix}${connector}${flat_label(node)}`);
    shown++;
    const kids: number[] = children.get(id) ?? [];
    const childPrefix: string = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
    kids.forEach((kid: number, i: number): void => emit(kid, childPrefix, i === kids.length - 1, false));
  };

  roots.forEach((rootID: number, i: number): void => emit(rootID, '', i === roots.length - 1, roots.length === 1));
  return { lines, shown, truncated };
}

/** Walks the collapsed tree, using double-line connectors for `×N` groups. */
function collapsed_walk(roots: CollapsedNode[], maxNodes: number): TreeWalk {
  const lines: string[] = [];
  let shown: number = 0;
  let truncated: boolean = false;

  const emit = (node: CollapsedNode, prefix: string, isLast: boolean, isRoot: boolean): void => {
    if (shown >= maxNodes) { truncated = true; return; }
    const group: boolean = node.count > 1;
    const connector: string = isRoot ? '' : group ? (isLast ? '╘═ ' : '╞═ ') : (isLast ? '└─ ' : '├─ ');
    lines.push(`${prefix}${connector}${collapsedNode_label(node)}`);
    shown++;
    const childPrefix: string = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
    node.children.forEach((child: CollapsedNode, i: number): void =>
      emit(child, childPrefix, i === node.children.length - 1, false));
  };

  roots.forEach((root: CollapsedNode, i: number): void => emit(root, '', i === roots.length - 1, roots.length === 1));
  return { lines, shown, truncated };
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
  const cap: number = maxNodes > 0 ? maxNodes : Number.MAX_SAFE_INTEGER;
  const { lines, shown, truncated }: TreeWalk = flat
    ? tree_walk(graph, roots, cap)
    : collapsed_walk(collapse_build(graph, roots), cap);

  const mode: string = flat ? chalk.dim(' [flat]') : '';
  const header: string =
    `${chalk.bold(`feed ${graph.feedID}`)} ${chalk.gray(`"${graph.title}"`)} — ` +
    `${status_paint(graph.feedStatus)} · ${graph.total} nodes${mode}` +
    (truncated ? chalk.yellow(`  (showing ${shown}; --max-nodes 0 for all, --focus <id> to scope)`) : '');

  return { rendered: `${header}\n${lines.join('\n')}\n`, shown, truncated };
}
