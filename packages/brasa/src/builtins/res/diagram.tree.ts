/**
 * @file Shared shallow-tree and diagram node model for feed and pipeline DAGs.
 *
 * Feed and pipeline adapters supply the labels and topology; this module owns
 * connector walking, join annotation, argument formatting, and node limits.
 * The same node model also feeds the SignalFlow emitter.
 *
 * @module
 */
import chalk from 'chalk';

/** One command argument displayed by a shallow pipeline diagram. */
export interface DiagramArgument {
  name: string;
  value: unknown;
}

/** One nested node consumed by every diagram renderer. */
export interface DiagramNode {
  memberIDs: number[];
  pluginName: string;
  functionName: string;
  signalName: string;
  label: string;
  multiplicity: number;
  hasJoin: boolean;
  joinParentIDs: number[];
  arguments: DiagramArgument[];
  children: DiagramNode[];
}

/** Minimal flat-node topology consumed by the shared nesting pass. */
export interface DiagramTopologyNode {
  id: number;
  parentID: number | null;
}

/** Result of a bounded shallow-tree walk. */
export interface DiagramTreeWalk {
  rendered: string;
  shown: number;
  truncated: boolean;
}

/**
 * Converts a flat parent-linked graph into nested renderer nodes.
 *
 * @param nodes - Flat domain nodes carrying IDs and anchor-parent IDs.
 * @param rootIDs - IDs that begin the rendered forest, in display order.
 * @param node_project - Domain adapter that supplies labels and renderer data.
 * @returns Nested shared diagram nodes in the requested root/child order.
 */
export function diagramTopology_nest<T extends DiagramTopologyNode>(
  nodes: T[],
  rootIDs: number[],
  node_project: (node: T, children: DiagramNode[]) => DiagramNode,
): DiagramNode[] {
  const byID: Map<number, T> = new Map<number, T>(
    nodes.map((node: T): [number, T] => [node.id, node]),
  );
  const childrenByID: Map<number, number[]> = new Map<number, number[]>();
  for (const node of nodes) {
    if (node.parentID === null) continue;
    const children: number[] = childrenByID.get(node.parentID) ?? [];
    children.push(node.id);
    childrenByID.set(node.parentID, children);
  }

  const node_nest = (id: number): DiagramNode | null => {
    const node: T | undefined = byID.get(id);
    if (!node) return null;
    const children: DiagramNode[] = (childrenByID.get(id) ?? [])
      .map((childID: number): DiagramNode | null => node_nest(childID))
      .filter((child: DiagramNode | null): child is DiagramNode => child !== null);
    return node_project(node, children);
  };

  return rootIDs
    .map((rootID: number): DiagramNode | null => node_nest(rootID))
    .filter((root: DiagramNode | null): root is DiagramNode => root !== null);
}

/**
 * Formats a pipeline default as a shell-safe display token.
 *
 * @param value - Stored CUBE default value.
 * @returns A deterministic shell-like token.
 */
function argumentValue_render(value: unknown): string {
  const raw: string = typeof value === 'object' && value !== null
    ? JSON.stringify(value)
    : String(value);
  if (raw.length === 0) return "''";
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(raw)) return raw;
  return `'${raw.replace(/'/g, `'"'"'`)}'`;
}

/** Renders concrete non-null arguments in their stored order. */
function arguments_render(argumentsList: DiagramArgument[]): string {
  return argumentsList
    .filter((argument: DiagramArgument): boolean => argument.value !== null)
    .map((argument: DiagramArgument): string => `--${argument.name} ${argumentValue_render(argument.value)}`)
    .join(' ');
}

/**
 * Walks nested diagram nodes using the shared shallow box-drawing layout.
 *
 * @param roots - Diagram roots.
 * @param maxNodes - Node cap; zero means unlimited.
 * @param withArguments - Whether stored pipeline defaults are appended inline.
 * @returns Rendered tree body plus count and truncation metadata.
 */
export function diagramTree_walk(
  roots: DiagramNode[],
  maxNodes: number,
  withArguments: boolean = false,
): DiagramTreeWalk {
  const lines: string[] = [];
  const cap: number = maxNodes > 0 ? maxNodes : Number.MAX_SAFE_INTEGER;
  let shown: number = 0;
  let truncated: boolean = false;

  const emit = (node: DiagramNode, prefix: string, isLast: boolean, isRoot: boolean): void => {
    if (shown >= cap) {
      truncated = true;
      return;
    }
    const grouped: boolean = node.multiplicity > 1;
    const connector: string = isRoot ? '' : grouped ? (isLast ? '╘═ ' : '╞═ ') : (isLast ? '└─ ' : '├─ ');
    const argumentText: string = withArguments ? arguments_render(node.arguments) : '';
    const joinText: string = node.joinParentIDs.length > 0
      ? chalk.magenta(`  ⋈ joins ${node.joinParentIDs.join(',')}`)
      : node.hasJoin ? chalk.magenta('  ⋈') : '';
    lines.push(`${prefix}${connector}${node.label}${argumentText ? ` ${argumentText}` : ''}${joinText}`);
    shown++;
    const childPrefix: string = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
    node.children.forEach((child: DiagramNode, index: number): void => {
      emit(child, childPrefix, index === node.children.length - 1, false);
    });
  };

  roots.forEach((root: DiagramNode, index: number): void => {
    emit(root, '', index === roots.length - 1, roots.length === 1);
  });
  return { rendered: lines.join('\n'), shown, truncated };
}
