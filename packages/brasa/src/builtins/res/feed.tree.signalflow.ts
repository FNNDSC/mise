/**
 * @file Adapter: a collapsed feed DAG → a SignalFlow document.
 *
 * Pure (no network, no salsa runtime — consumes the {@link CollapsedNode} tree from the
 * collapse pass). Produces a SignalFlow doc object that serializes to JSON (valid YAML)
 * for the SignalFlow renderer. SignalFlow is a replaceable rendering leaf: the render IR
 * is the feed graph, and this converter is the only SignalFlow-shaped code.
 *
 * Mapping:
 * - each collapsed node → one SignalFlow chip (`module` = `<plugin>.plugin`, `func` unique;
 *   a `×N` group is one named chip);
 * - each anchor edge → a minted `signal` (parent `output_ports` → child `input_ports`);
 * - each `ts` join (singletons only; groups aggregate joins away) → the node-reuse recipe:
 *   the join node is declared fully under its anchor parent and referenced *bare* under each
 *   join source, which emits the matching signal, with `chip_io.input.explicit`.
 *
 * @module
 */
import type { CollapsedNode } from './feed.tree.collapse.js';

/** A SignalFlow port (forward-only: signal, no return). */
interface SfPort { signal: string; }

/** A SignalFlow chip node. */
export interface SfNode {
  module: string;
  func: string;
  input_ports?: SfPort[];
  output_ports?: SfPort[];
  chip_io?: { input: { explicit: boolean } };
  calls: SfNode[];
}

/** A complete SignalFlow document. */
export interface SfDoc {
  title: string;
  config: { channelWidth: number; verticalChipPadding: number };
  world: { sense: string; occupancy_policy: string; packing_policy: string };
  tree: SfNode;
}

/** Options for {@link signalflowDoc_build}. */
export interface SignalflowDocOptions {
  feedID: number;
  title: string;
}

/** Unique, human-readable chip identity for a collapsed node. */
function node_func(n: CollapsedNode): string {
  return n.count === 1
    ? `${n.pluginName}_${n.memberIds[0]}`
    : `${n.pluginName}_x${n.count}_${n.memberIds[0]}`;
}

/** Signal name for the anchor edge into a node. */
function edge_signal(n: CollapsedNode): string {
  return `e_${node_func(n)}`;
}

/** Signal name for a join edge from `source` into `join` node. */
function join_signal(join: CollapsedNode, source: CollapsedNode): string {
  return `j_${node_func(join)}_${node_func(source)}`;
}

/** Precomputed join wiring: input signals per join node, and bare refs + output signals per source. */
interface JoinWiring {
  inputSignals: Map<CollapsedNode, string[]>;
  bareRefs: Map<CollapsedNode, CollapsedNode[]>;
  outputSignals: Map<CollapsedNode, string[]>;
}

/**
 * Builds a SignalFlow document from the collapsed roots of a feed DAG.
 *
 * @param roots - Top-level collapsed nodes (feed roots, or a focused subtree).
 * @param options - Feed id and title for the document header.
 * @returns A SignalFlow document object (serialize to JSON for the renderer).
 */
export function signalflowDoc_build(roots: CollapsedNode[], options: SignalflowDocOptions): SfDoc {
  // Index every node and map member instance ids → the node that holds them (a join
  // source may live inside a collapsed group).
  const allNodes: CollapsedNode[] = [];
  const memberToNode: Map<number, CollapsedNode> = new Map<number, CollapsedNode>();
  const collect = (n: CollapsedNode): void => {
    allNodes.push(n);
    for (const id of n.memberIds) memberToNode.set(id, n);
    for (const c of n.children) collect(c);
  };
  for (const r of roots) collect(r);

  const wiring: JoinWiring = {
    inputSignals: new Map<CollapsedNode, string[]>(),
    bareRefs: new Map<CollapsedNode, CollapsedNode[]>(),
    outputSignals: new Map<CollapsedNode, string[]>(),
  };
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V): void => { m.set(k, [...(m.get(k) ?? []), v]); };

  for (const join of allNodes) {
    if (join.count !== 1 || join.joinParentIDs.length === 0) continue;
    for (const sourceId of join.joinParentIDs) {
      const source: CollapsedNode | undefined = memberToNode.get(sourceId);
      if (!source || source === join) continue;
      const sig: string = join_signal(join, source);
      push(wiring.inputSignals, join, sig);
      push(wiring.outputSignals, source, sig);
      push(wiring.bareRefs, source, join);
    }
  }

  const buildFull = (n: CollapsedNode, hasAnchorParent: boolean): SfNode => {
    const func: string = node_func(n);
    const inputs: SfPort[] = [];
    if (hasAnchorParent) inputs.push({ signal: edge_signal(n) });
    for (const sig of wiring.inputSignals.get(n) ?? []) inputs.push({ signal: sig });

    const outputs: SfPort[] = [];
    for (const c of n.children) outputs.push({ signal: edge_signal(c) });
    for (const sig of wiring.outputSignals.get(n) ?? []) outputs.push({ signal: sig });

    const calls: SfNode[] = n.children.map((c: CollapsedNode): SfNode => buildFull(c, true));
    for (const ref of wiring.bareRefs.get(n) ?? []) {
      calls.push({ module: `${ref.pluginName}.plugin`, func: node_func(ref), calls: [] });
    }

    const node: SfNode = { module: `${n.pluginName}.plugin`, func, calls };
    if (inputs.length) node.input_ports = inputs;
    if (outputs.length) node.output_ports = outputs;
    if ((wiring.inputSignals.get(n) ?? []).length) node.chip_io = { input: { explicit: true } };
    return node;
  };

  let tree: SfNode;
  if (roots.length === 1) {
    tree = buildFull(roots[0], false);
  } else {
    tree = {
      module: 'feed.root',
      func: `feed_${options.feedID}`,
      output_ports: roots.map((r: CollapsedNode): SfPort => ({ signal: edge_signal(r) })),
      calls: roots.map((r: CollapsedNode): SfNode => buildFull(r, true)),
    };
  }

  return {
    title: `feed ${options.feedID}: ${options.title}`,
    config: { channelWidth: 6, verticalChipPadding: 1 },
    world: { sense: 'west_to_east', occupancy_policy: 'strip', packing_policy: 'monotone' },
    tree,
  };
}
