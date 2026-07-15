import { describe, it, expect } from '@jest/globals';
import { collapse_build } from '../src/builtins/res/feed.tree.collapse.js';
import { signalflowDoc_build, SfNode } from '../src/builtins/res/feed.tree.signalflow.js';
import type { FeedGraph, FeedNode } from '@fnndsc/salsa';

function node(id: number, parentID: number | null, pluginName: string, signature: string, joins: number[] = []): FeedNode {
  return { id, pluginName, parentID, signature, joinParentIDs: joins, status: 'finishedSuccessfully' };
}
function graph(nodes: FeedNode[], rootIDs: number[]): FeedGraph {
  return { feedID: 9, title: 'demo', feedStatus: 'x', total: nodes.length, shown: nodes.length, truncated: false, rootIDs, nodes };
}
function doc(nodes: FeedNode[], rootIDs: number[]) {
  return signalflowDoc_build(collapse_build(graph(nodes, rootIDs), rootIDs), { feedID: 9, title: 'demo' });
}
/** Depth-first find a chip by func. */
function find(root: SfNode, func: string): SfNode | undefined {
  if (root.func === func) return root;
  for (const c of root.calls) { const hit = find(c, func); if (hit) return hit; }
  return undefined;
}

describe('signalflowDoc_build', () => {
  it('renders a linear chain as nested chips wired by edge signals', () => {
    const d = doc([
      node(1, null, 'pl-a', 'A'),
      node(2, 1, 'pl-b', 'B'),
    ], [1]);
    expect(d.tree.func).toBe('pl-a_1');
    expect(d.tree.output_ports).toEqual([{ signal: 'e_pl-b_2' }]);
    const b = d.tree.calls[0];
    expect(b.func).toBe('pl-b_2');
    expect(b.input_ports).toEqual([{ signal: 'e_pl-b_2' }]);
  });

  it('renders an isomorphic fan-out as one named ×N group chip', () => {
    const d = doc([
      node(1, null, 'pl-root', 'R'),
      node(10, 1, 'pl-dcm2niix', 'A'),
      node(11, 1, 'pl-dcm2niix', 'A'),
      node(12, 1, 'pl-dcm2niix', 'A'),
    ], [1]);
    const group = d.tree.calls[0];
    expect(group.func).toBe('pl-dcm2niix_x3_10'); // one chip, count in the name
    expect(d.tree.calls).toHaveLength(1);          // not three
  });

  it('wires a ts join via node reuse: full under anchor, bare under source, matched signals', () => {
    const d = doc([
      node(1, null, 'pl-root', 'R'),
      node(10, 1, 'pl-a', 'A'),
      node(11, 1, 'pl-b', 'B'),
      node(12, 10, 'pl-ts', 'T', [11]), // ts under A(10), joins B(11)
    ], [1]);
    const sig = 'j_pl-ts_12_pl-b_11';

    // full declaration under its anchor parent A: both inputs + explicit hub
    const tsFull = find(d.tree, 'pl-ts_12')!;
    expect(tsFull.input_ports).toEqual([{ signal: 'e_pl-ts_12' }, { signal: sig }]);
    expect(tsFull.chip_io).toEqual({ input: { explicit: true } });

    // join source B emits the signal AND hosts a bare reference to the ts node
    const b = find(d.tree, 'pl-b_11')!;
    expect(b.output_ports).toContainEqual({ signal: sig });
    const bareRef = b.calls.find((c) => c.func === 'pl-ts_12');
    expect(bareRef).toBeDefined();
    expect(bareRef!.input_ports).toBeUndefined(); // bare: no metadata
    expect(bareRef!.calls).toEqual([]);
  });

  it('synthesizes a root chip when a feed has multiple roots', () => {
    const d = doc([
      node(1, null, 'pl-x', 'X'),
      node(2, null, 'pl-y', 'Y'),
    ], [1, 2]);
    expect(d.tree.func).toBe('feed_9');
    expect(d.tree.calls.map((c) => c.func).sort()).toEqual(['pl-x_1', 'pl-y_2']);
  });
});
