/**
 * @file The universe's settle, off the page.
 *
 * A worker runs whether or not its tab is shown, and never holds the page:
 * a hidden tab used to freeze a settle at whatever it had reached, and a
 * settle on the page's own thread cost every frame it ran in. The worker is
 * a host only: the engines are orrery's, found by name.
 *
 * @module
 */
import { layoutEngine_get, type HierarchyArrangement, type HierarchyNode, type LayoutEngine, type PhysicsTerms } from '@fnndsc/orrery/layout';

/** What the page asks: a generation, the nodes, the physics, the engine. */
interface LayoutAsk {
  generation: number;
  nodes: HierarchyNode[];
  physics: PhysicsTerms;
  arrangement: HierarchyArrangement;
}

self.onmessage = (event: MessageEvent<LayoutAsk>): void => {
  const { generation, nodes, physics, arrangement } = event.data;
  let last: number = -1;
  const progress = (fraction: number): void => {
    const percent: number = Math.floor(fraction * 100);
    if (percent === last) return;
    last = percent;
    self.postMessage({ generation, type: 'progress', fraction });
  };
  const engine: LayoutEngine | undefined = layoutEngine_get(arrangement);
  if (engine === undefined) {
    self.postMessage({ generation, type: 'failed', reason: `no layout engine named ${arrangement}` });
    return;
  }
  const { positions } = engine.run({ nodes, physics }, progress);
  self.postMessage({ generation, type: 'done', positions });
};
