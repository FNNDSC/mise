/**
 * @file Pure renderer for `feed tree` — turns a FeedGraph into an annotated text tree.
 *
 * No network and no runtime dependency on salsa (types only), so it is unit-testable in
 * isolation. The anchor tree is drawn with box-drawing connectors; topological-join (`ts`)
 * nodes are annotated inline with the extra sources they merge.
 *
 * @module
 */
import chalk from 'chalk';
import type { FeedGraph, FeedNode } from '@fnndsc/salsa';

/** Colors a status label for the tree. */
export function status_paint(status: string | null): string {
  if (status === null) return chalk.dim('·');
  if (status === 'finishedSuccessfully') return chalk.green(status);
  if (status === 'finishedWithError') return chalk.red(status);
  if (status === 'cancelled') return chalk.yellow(status);
  return chalk.cyan(status);
}

/** One node's line body (name, status, join annotation). */
function node_label(node: FeedNode): string {
  const name: string = `${node.pluginName}_${node.id}`;
  const status: string = status_paint(node.status);
  const join: string = node.joinParentIDs.length > 0
    ? chalk.magenta(`  ⋈ joins ${node.joinParentIDs.join(',')}`)
    : '';
  return `${name}  ${status}${join}`;
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

  const emit = (id: number, prefix: string, isLast: boolean, isRoot: boolean): void => {
    if (shown >= maxNodes) { truncated = true; return; }
    const node: FeedNode | undefined = byId.get(id);
    if (!node) return;
    const connector: string = isRoot ? '' : isLast ? '└─ ' : '├─ ';
    lines.push(`${prefix}${connector}${node_label(node)}`);
    shown++;
    const kids: number[] = children.get(id) ?? [];
    const childPrefix: string = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
    kids.forEach((kid: number, i: number): void => emit(kid, childPrefix, i === kids.length - 1, false));
  };

  roots.forEach((rootID: number, i: number): void => emit(rootID, '', i === roots.length - 1, roots.length === 1));
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
 * Pure render of a {@link FeedGraph} into an annotated tree. Returns `error` when
 * `focusId` is not a node in the graph.
 *
 * @param graph - The feed's DAG.
 * @param focusId - Optional subtree root to scope the render to.
 * @param maxNodes - Node cap (0 = unlimited).
 * @returns The rendered tree and counts, or an error message.
 */
export function feedTree_render(
  graph: FeedGraph,
  focusId: number | undefined,
  maxNodes: number,
): FeedTreeRender {
  if (focusId !== undefined && !graph.nodes.some((n: FeedNode): boolean => n.id === focusId)) {
    return { rendered: '', shown: 0, truncated: false, error: `Node ${focusId} is not in feed ${graph.feedID}.` };
  }

  const roots: number[] = focusId !== undefined ? [focusId] : graph.rootIDs;
  const cap: number = maxNodes > 0 ? maxNodes : graph.total;
  const { lines, shown, truncated }: TreeWalk = tree_walk(graph, roots, cap);

  const header: string =
    `${chalk.bold(`feed ${graph.feedID}`)} ${chalk.gray(`"${graph.title}"`)} — ` +
    `${status_paint(graph.feedStatus)} · ${graph.total} nodes` +
    (truncated ? chalk.yellow(`  (showing ${shown}; --max-nodes 0 for all, --focus <id> to scope)`) : '');

  return { rendered: `${header}\n${lines.join('\n')}\n`, shown, truncated };
}
